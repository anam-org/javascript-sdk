import { ClientError, ErrorCode } from '../lib/ClientError';
import {
  CLIENT_METADATA,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_VERSION,
} from '../lib/constants';
import {
  ApiOptions,
  PersonaConfig,
  StartSessionResponse,
  ProxyConfig,
} from '../types';
import { StartSessionOptions } from '../types/coreApi/StartSessionOptions';
import { isCustomPersonaConfig } from '../types/PersonaConfig';

export class CoreApiRestClient {
  private baseUrl: string;
  private apiVersion: string;
  private apiKey: string | null;
  private sessionToken: string | null;
  private proxyConfig: ProxyConfig | undefined;

  constructor(sessionToken?: string, apiKey?: string, options?: ApiOptions) {
    if (!sessionToken && !apiKey) {
      throw new Error('Either sessionToken or apiKey must be provided');
    }
    this.sessionToken = sessionToken || null;
    this.apiKey = apiKey || null;
    this.baseUrl = options?.baseUrl || DEFAULT_API_BASE_URL;
    this.apiVersion = options?.apiVersion || DEFAULT_API_VERSION;
    this.proxyConfig = options?.proxy || undefined;
  }

  /**
   * Builds URL and headers for a request, applying proxy configuration if enabled
   */
  private buildProxiedUrlAndHeaders(
    targetPath: string,
    baseHeaders: Record<string, string>,
  ): { url: string; headers: Record<string, string> } {
    if (this.proxyConfig?.enabled && this.proxyConfig?.api) {
      // Use proxy base URL with same endpoint path
      const url = `${this.proxyConfig.api}${targetPath}`;
      // Add standard forwarding headers
      const targetUrl = new URL(`${this.baseUrl}${targetPath}`);
      const headers = {
        ...baseHeaders,
        'X-Forwarded-Host': targetUrl.host,
        'X-Forwarded-Proto': targetUrl.protocol.slice(0, -1),
        'X-Original-URI': targetPath,
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
      this.sessionToken = await this.unsafe_getSessionToken(personaConfig);
    }

    // Check if brainType is being used and log deprecation warning
    if (personaConfig && 'brainType' in personaConfig) {
      console.warn(
        'Warning: brainType is deprecated and will be removed in a future version. Please use llmId instead.',
      );
    }

    try {
      const targetPath = `${this.apiVersion}/engine/session`;
      const { url, headers } = this.buildProxiedUrlAndHeaders(targetPath, {
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
            500,
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
    }
  }

  public async unsafe_getSessionToken(
    personaConfig: PersonaConfig,
  ): Promise<string> {
    console.warn(
      'Using unsecure method. This method should not be used in production.',
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

    let body: { clientLabel: string; personaConfig?: PersonaConfig } = {
      clientLabel: 'js-sdk-api-key',
    };
    if (isCustomPersonaConfig(personaConfig)) {
      body = { ...body, personaConfig };
    }
    try {
      const targetPath = `${this.apiVersion}/auth/session-token`;
      const { url, headers } = this.buildProxiedUrlAndHeaders(targetPath, {
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
