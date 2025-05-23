export interface StartSessionResponse {
  sessionId: string;
  engineHost: string;
  engineProtocol: string;
  signallingEndpoint: string;
  clientConfig: ClientConfigResponse;
}

export interface ClientConfigResponse {
  heartbeatIntervalSeconds: number;
  maxWsReconnectionAttempts: number;
  iceServers: RTCIceServer[];
}
