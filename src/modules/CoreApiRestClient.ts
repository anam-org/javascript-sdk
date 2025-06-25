import { ClientError, ErrorCode } from '../lib/ClientError';
import {
  CLIENT_METADATA,
  DEFAULT_API_BASE_URL,
  DEFAULT_API_VERSION,
} from '../lib/constants';
import {
  CoreApiRestClientOptions,
  PersonaConfig,
  StartSessionResponse,
} from '../types';
import { StartSessionOptions } from '../types/coreApi/StartSessionOptions';
import { isCustomPersonaConfig } from '../types/PersonaConfig';

export class CoreApiRestClient {
  private baseUrl: string;
  private apiVersion: string;
  private apiKey: string | null;
  private sessionToken: string | null;

  constructor(
    sessionToken?: string,
    apiKey?: string,
    options?: CoreApiRestClientOptions,
  ) {
    if (!sessionToken && !apiKey) {
      throw new Error('Either sessionToken or apiKey must be provided');
    }
    this.sessionToken = sessionToken || null;
    this.apiKey = apiKey || null;
    this.baseUrl = options?.baseUrl || DEFAULT_API_BASE_URL;
    this.apiVersion = options?.apiVersion || DEFAULT_API_VERSION;
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

    try {
      const response = await fetch(`${this.getApiUrl()}/engine/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.sessionToken}`,
        },
        body: JSON.stringify({
          personaConfig,
          sessionOptions,
          clientMetadata: CLIENT_METADATA,
        }),
      });

      const data = await response.json();

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
          throw new ClientError(
            'Usage limit reached, please upgrade your plan',
            ErrorCode.CLIENT_ERROR_CODE_USAGE_LIMIT_REACHED,
            429,
            { cause: data.message },
          );
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
    let body: { clientLabel: string; personaConfig?: PersonaConfig } = {
      clientLabel: 'js-sdk-api-key',
    };
    if (isCustomPersonaConfig(personaConfig)) {
      body = { ...body, personaConfig };
    }
    try {
      const response = await fetch(`${this.getApiUrl()}/auth/session-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
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
