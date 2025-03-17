import { ClientError, ErrorCode } from '../lib/ClientError';
import { DEFAULT_API_BASE_URL, DEFAULT_API_VERSION } from '../lib/constants';
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
          ErrorCode.VALIDATION_ERROR,
          400,
        );
      }
      // TODO: why do we need to get the unsafe session token here?
      this.sessionToken = await this.unsafe_getSessionToken(personaConfig);
    }

    try {
      const response = await fetch(`${this.getApiUrl()}/engine/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.sessionToken}`,
        },
        body: JSON.stringify({ personaConfig, sessionOptions }),
      });

      switch (response.status) {
        case 200:
          const data: StartSessionResponse = await response.json();
          return data;
        case 400:
          throw new ClientError(
            'Invalid request to start session',
            ErrorCode.VALIDATION_ERROR,
            400,
          );
        case 401:
          throw new ClientError(
            'Authentication failed when starting session',
            ErrorCode.AUTHENTICATION_ERROR,
            401,
          );
        case 403:
          throw new ClientError(
            'Authentication failed when starting session',
            ErrorCode.AUTHENTICATION_ERROR,
            403,
          );
        case 429:
          throw new ClientError(
            'Out of credits, please upgrade your plan',
            ErrorCode.USAGE_LIMIT_REACHED,
            429,
          );
        default:
          throw new ClientError(
            'Unknown error when starting session',
            ErrorCode.SERVER_ERROR,
            500,
            { cause: response.statusText },
          );
      }
    } catch (error) {
      if (error instanceof ClientError) {
        throw error;
      }
      throw new ClientError(
        'Failed to start session',
        ErrorCode.SERVER_ERROR,
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
