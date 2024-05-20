import { DEFAULT_API_BASE_URL, DEFAULT_API_VERSION } from '../lib/constants';
import {
  CoreApiRestClientOptions,
  PersonaConfig,
  StartSessionResponse,
} from '../types';

export class CoreApiRestClient {
  protected baseUrl: string;
  protected apiVersion: string;
  protected apiKey: string | null;
  protected sessionToken: string | null;

  constructor(
    sessionToken?: string,
    apiKey?: string,
    options: CoreApiRestClientOptions = {},
  ) {
    if (!sessionToken && !apiKey) {
      throw new Error('Either sessionToken or apiKey must be provided');
    }
    this.sessionToken = sessionToken || null;
    this.apiKey = apiKey || null;
    this.baseUrl = options.baseUrl || DEFAULT_API_BASE_URL;
    this.apiVersion = options.apiVersion || DEFAULT_API_VERSION;
  }

  public async startSession(
    personaConfig: PersonaConfig,
  ): Promise<StartSessionResponse> {
    if (!this.sessionToken) {
      this.sessionToken = await this.unsafe_getSessionToken();
    }
    try {
      const response = await fetch(`${this.getApiUrl()}/engine/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.sessionToken}`,
        },
        body: JSON.stringify({ personaConfig }),
      });
      const data: StartSessionResponse = await response.json();
      return data;
    } catch (error) {
      throw new Error('Failed to start session');
    }
  }

  public async unsafe_getSessionToken(): Promise<string> {
    console.warn(
      'Using unsecure method. This method should not be used in production.',
    );
    if (!this.apiKey) {
      throw new Error('No apiKey provided');
    }
    try {
      const response = await fetch(`${this.getApiUrl()}/auth/session-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
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
