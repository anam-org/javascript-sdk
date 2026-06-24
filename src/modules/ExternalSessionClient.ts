import { StartSessionOptions } from '../types/coreApi/StartSessionOptions';

export interface ExternalSessionClientConfig {
  baseUrl: string; // e.g., window.location.origin
  startSessionPath?: string; // default: '/v1/auth/session'
  getUserId: () => string;
  headers?: Record<string, string>;
}

export interface ExternalStartSessionResponse {
  sessionId: string;
  engineHost: string;
  engineProtocol: 'http' | 'https';
  signallingEndpoint: string;
  clientConfig?: {
    heartbeatIntervalSeconds?: number;
    maxWsReconnectionAttempts?: number;
    iceServers: RTCIceServer[];
  };
  userId?: string;
}

export class ExternalSessionClient {
  private config: ExternalSessionClientConfig;

  constructor(config: ExternalSessionClientConfig) {
    this.config = config;
  }

  public async startSession(
    _sessionOptions?: StartSessionOptions,
  ): Promise<ExternalStartSessionResponse> {
    const path = this.config.startSessionPath ?? '/v1/auth/session';
    const userId = this.config.getUserId();
    const res = await fetch(this.config.baseUrl + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`External session start failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as ExternalStartSessionResponse;
    return data;
  }
}
