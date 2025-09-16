export interface SignallingURLOptions {
  baseUrl?: string;
  protocol?: string;
  port?: string;
  signallingPath?: string;
  /**
   * When provided, a complete absolute WebSocket URL is used as-is.
   * Example: wss://example.com/v1/agents/123/ws?engineHost=...&engineProtocol=...&signallingEndpoint=...&session_id=...
   */
  absoluteWsUrl?: string;
}

export interface SignallingClientOptions {
  heartbeatIntervalSeconds?: number;
  maxWsReconnectionAttempts?: number;
  url: SignallingURLOptions;
}
