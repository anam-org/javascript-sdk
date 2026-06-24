import { ClientError, ErrorCode } from '../lib/ClientError';
import {
  CLIENT_METADATA,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_VERSION,
  DEFAULT_START_SESSION_INITIAL_BACKOFF_MS,
  DEFAULT_START_SESSION_MAX_ATTEMPTS,
  DEFAULT_START_SESSION_MAX_BACKOFF_MS,
  DEFAULT_START_SESSION_REQUEST_TIMEOUT_MS,
} from '../lib/constants';
import {
  ApiOptions,
  PersonaConfig,
  StartSessionResponse,
  ApiGatewayConfig,
  SessionOptions,
} from '../types';
import { RetryOptions } from '../types/coreApi/ApiOptions';
import { StartSessionOptions } from '../types/coreApi/StartSessionOptions';

interface ResolvedRetryOptions {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

export class CoreApiRestClient {
  private baseUrl: string;
  private apiVersion: string;
  private apiKey: string | null;
  private sessionToken: string | null;
  private apiGatewayConfig: ApiGatewayConfig | undefined;
  private retryOptions: ResolvedRetryOptions;
  private requestTimeoutMs: number;
  // Session options applied only when this client mints its own token (the
  // unsafe API-key path). Named distinctly from `StartSessionOptions` to avoid
  // confusing the two payloads.
  private tokenSessionOptions: SessionOptions | undefined;

  constructor(
    sessionToken?: string,
    apiKey?: string,
    options?: ApiOptions,
    tokenSessionOptions?: SessionOptions,
  ) {
    if (!sessionToken && !apiKey) {
      throw new Error('Either sessionToken or apiKey must be provided');
    }
    this.sessionToken = sessionToken || null;
    this.apiKey = apiKey || null;
    this.baseUrl = options?.baseUrl || DEFAULT_API_BASE_URL;
    this.apiVersion = options?.apiVersion || DEFAULT_API_VERSION;
    this.apiGatewayConfig = options?.apiGateway || undefined;
    this.retryOptions = resolveRetryOptions(options?.retry);
    this.requestTimeoutMs = Math.max(
      0,
      asFiniteNumber(
        options?.requestTimeoutMs,
        DEFAULT_START_SESSION_REQUEST_TIMEOUT_MS,
      ),
    );
    this.tokenSessionOptions = tokenSessionOptions;
  }

  /**
   * Builds URL and headers for a request, applying API Gateway configuration if enabled
   */
  private buildGatewayUrlAndHeaders(
    targetPath: string,
    baseHeaders: Record<string, string>,
  ): { url: string; headers: Record<string, string> } {
    if (this.apiGatewayConfig?.enabled && this.apiGatewayConfig?.baseUrl) {
      // Use gateway base URL with same endpoint path
      const url = `${this.apiGatewayConfig.baseUrl}${targetPath}`;
      // Add complete target URL header for gateway routing
      const targetUrl = new URL(`${this.baseUrl}${targetPath}`);
      const headers = {
        ...baseHeaders,
        'X-Anam-Target-Url': targetUrl.href,
      };
      return { url, headers };
    } else {
      // Direct call to Anam API
      return {
        url: `${this.baseUrl}${targetPath}`,
        headers: baseHeaders,
      };
    }
  }

  public async startSession(
    personaConfig?: PersonaConfig,
    sessionOptions?: StartSessionOptions,
  ): Promise<StartSessionResponse> {
    if (!this.sessionToken) {
      if (!personaConfig) {
        throw new ClientError(
          'Persona configuration must be provided when using apiKey',
          ErrorCode.CLIENT_ERROR_CODE_VALIDATION_ERROR,
          400,
        );
      }
      this.sessionToken = await this.unsafe_getSessionToken(
        personaConfig,
        this.tokenSessionOptions,
      );
    }

    // Check if brainType is being used and log deprecation warning
    if (personaConfig && 'brainType' in personaConfig) {
      console.warn(
        'Warning: brainType is deprecated and will be removed in a future version. Please use llmId instead.',
      );
    }

    const { maxAttempts } = this.retryOptions;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.attemptStartSession(personaConfig, sessionOptions);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableError(error)) {
          throw error;
        }
        await sleep(this.computeBackoffDelay(attempt));
      }
    }
    throw lastError;
  }

  private async attemptStartSession(
    personaConfig?: PersonaConfig,
    sessionOptions?: StartSessionOptions,
  ): Promise<StartSessionResponse> {
    const controller =
      this.requestTimeoutMs > 0 ? new AbortController() : undefined;
    const timeoutHandle =
      controller !== undefined
        ? setTimeout(() => controller.abort(), this.requestTimeoutMs)
        : undefined;
    try {
      const targetPath = `${this.apiVersion}/engine/session`;
      const { url, headers } = this.buildGatewayUrlAndHeaders(targetPath, {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.sessionToken}`,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          personaConfig,
          sessionOptions,
          clientMetadata: CLIENT_METADATA,
        }),
        signal: controller?.signal,
      });

      const data = await response.json();

      const errorCause: string | undefined = data.error;

      switch (response.status) {
        case 200:
        case 201:
          return data as StartSessionResponse;
        case 400:
          throw new ClientError(
            'Invalid request to start session',
            ErrorCode.CLIENT_ERROR_CODE_VALIDATION_ERROR,
            400,
            { cause: data.message },
          );
        case 401:
          throw new ClientError(
            'Authentication failed when starting session',
            ErrorCode.CLIENT_ERROR_CODE_AUTHENTICATION_ERROR,
            401,
            { cause: data.message },
          );
        case 402:
          throw new ClientError(
            'Please sign up for a plan to start a session',
            ErrorCode.CLIENT_ERROR_CODE_NO_PLAN_FOUND,
            402,
            { cause: data.message },
          );
        case 403:
          throw new ClientError(
            'Authentication failed when starting session',
            ErrorCode.CLIENT_ERROR_CODE_AUTHENTICATION_ERROR,
            403,
            { cause: data.message },
          );
        case 429:
          if (errorCause === 'Concurrent session limit reached') {
            throw new ClientError(
              'Concurrency limit reached, please upgrade your plan',
              ErrorCode.CLIENT_ERROR_CODE_MAX_CONCURRENT_SESSIONS_REACHED,
              429,
              { cause: data.message },
            );
          } else if (errorCause === 'Spend cap reached') {
            throw new ClientError(
              'Spend cap reached, please upgrade your plan',
              ErrorCode.CLIENT_ERROR_CODE_SPEND_CAP_REACHED,
              429,
              { cause: data.message },
            );
          } else {
            throw new ClientError(
              'Usage limit reached, please upgrade your plan',
              ErrorCode.CLIENT_ERROR_CODE_USAGE_LIMIT_REACHED,
              429,
              { cause: data.message },
            );
          }
        case 503:
          throw new ClientError(
            'There are no available personas, please try again later',
            ErrorCode.CLIENT_ERROR_CODE_SERVICE_BUSY,
            503,
            { cause: data.message },
          );
        default:
          throw new ClientError(
            'Unknown error when starting session',
            ErrorCode.CLIENT_ERROR_CODE_SERVER_ERROR,
            response.status,
            { cause: data.message },
          );
      }
    } catch (error) {
      if (error instanceof ClientError) {
        throw error;
      }
      throw new ClientError(
        'Failed to start session',
        ErrorCode.CLIENT_ERROR_CODE_SERVER_ERROR,
        500,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private computeBackoffDelay(attempt: number): number {
    const { initialBackoffMs, maxBackoffMs } = this.retryOptions;
    const exponential = Math.min(
      maxBackoffMs,
      initialBackoffMs * Math.pow(2, attempt - 1),
    );
    // Equal jitter: half deterministic, half random. Avoids both thundering
    // herd and zero-delay retries that would hammer a recovering origin.
    return Math.floor(exponential / 2 + Math.random() * (exponential / 2));
  }

  public async unsafe_getSessionToken(
    personaConfig: PersonaConfig,
    sessionOptions?: SessionOptions,
  ): Promise<string> {
    console.warn(
      'Using an insecure method. This method should not be used in production.',
    );
    if (!this.apiKey) {
      throw new Error('No apiKey provided');
    }

    // Check if brainType is being used and log deprecation warning
    if (personaConfig && 'brainType' in personaConfig) {
      console.warn(
        'Warning: brainType is deprecated and will be removed in a future version. Please use llmId instead.',
      );
    }

    assertValidSessionOptionsShape(sessionOptions);

    // Always forward the caller's personaConfig: the server resolves the avatar
    // model from it (e.g. to validate sessionOptions dimensions and to mint the
    // right token). Gating this on llmId/brainType previously dropped valid
    // configs that reference a persona by id or use the default LLM, which the
    // server then mis-classified as a model-less "legacy" session.
    const body: {
      clientLabel: string;
      personaConfig: PersonaConfig;
      sessionOptions?: SessionOptions;
    } = {
      clientLabel: 'js-sdk-api-key',
      personaConfig,
    };
    if (sessionOptions) {
      body.sessionOptions = sessionOptions;
    }
    try {
      const targetPath = `${this.apiVersion}/auth/session-token`;
      const { url, headers } = this.buildGatewayUrlAndHeaders(targetPath, {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return data.sessionToken;
    } catch (e) {
      throw new Error('Failed to get session token');
    }
  }

  private getApiUrl(): string {
    return `${this.baseUrl}${this.apiVersion}`;
  }
}

/**
 * Fail fast on an obviously-malformed session-options shape before the network
 * round-trip. This is ONLY a shape check (pair-completeness + positive integers)
 * — the server remains the source of truth for which dimension pairs each avatar
 * model actually supports, and rejects unsupported pairs.
 */
function assertValidSessionOptionsShape(sessionOptions?: SessionOptions): void {
  if (!sessionOptions) {
    return;
  }

  const { videoWidth, videoHeight } = sessionOptions;
  if ((videoWidth === undefined) !== (videoHeight === undefined)) {
    throw new ClientError(
      'videoWidth and videoHeight must be provided together',
      ErrorCode.CLIENT_ERROR_CODE_VALIDATION_ERROR,
      400,
    );
  }

  for (const [name, value] of [
    ['videoWidth', videoWidth],
    ['videoHeight', videoHeight],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new ClientError(
        `${name} must be a positive integer`,
        ErrorCode.CLIENT_ERROR_CODE_VALIDATION_ERROR,
        400,
      );
    }
  }
}

function resolveRetryOptions(options?: RetryOptions): ResolvedRetryOptions {
  // NaN/Infinity would silently break the retry loop or remove the backoff
  // cap, so coerce non-finite numerics back to the defaults before flooring.
  const maxAttempts = Math.max(
    1,
    Math.floor(
      asFiniteNumber(options?.maxAttempts, DEFAULT_START_SESSION_MAX_ATTEMPTS),
    ),
  );
  const initialBackoffMs = Math.max(
    0,
    asFiniteNumber(
      options?.initialBackoffMs,
      DEFAULT_START_SESSION_INITIAL_BACKOFF_MS,
    ),
  );
  const maxBackoffMs = Math.max(
    initialBackoffMs,
    asFiniteNumber(options?.maxBackoffMs, DEFAULT_START_SESSION_MAX_BACKOFF_MS),
  );
  return { maxAttempts, initialBackoffMs, maxBackoffMs };
}

function asFiniteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof ClientError) {
    return error.statusCode >= 500 && error.statusCode < 600;
  }
  // Unwrapped errors (e.g. fetch network failures that escape attemptStartSession
  // without being normalized to a ClientError) are treated as transient.
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
