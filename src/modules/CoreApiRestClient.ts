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
        throw new Error(
          'Persona configuration must be provided when using apiKey',
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
        body: JSON.stringify({ personaConfig, sessionOptions }),
      });
      const data: StartSessionResponse = await response.json();
      return data;
    } catch (error) {
      throw new Error('Failed to start session');
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
