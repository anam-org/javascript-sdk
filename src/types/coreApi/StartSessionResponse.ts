export interface StartSessionResponse {
  sessionId: string;
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
