export interface StartSessionResponse {
  sessionId: string;
  /**
   * Actual region that served the session. Known values today are `'eu'` and
   * `'us'`; additional regions may be introduced over time. Treat unrecognized
   * values as informational.
   */
  region?: string | null;
  engineHost: string;
  engineProtocol: string;
  signallingEndpoint: string;
  clientConfig: ClientConfigResponse;
}

export interface ClientConfigResponse {
  heartbeatIntervalSeconds: number;
  maxWsReconnectionAttempts: number;
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}
