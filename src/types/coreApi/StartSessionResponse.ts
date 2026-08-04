export interface StartSessionResponse {
  sessionId: string;
  region?: 'eu' | 'us';
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
