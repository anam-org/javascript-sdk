export interface StartSessionResponse {
  sessionId: string;
  engineHost: string;
  engineProtocol: string;
  signallingEndpoint: string;
  clientConfig: ClientConfigResponse;
}

export interface ClientConfigResponse {
  ablyToken: string;
  ablyChannel: string;
  iceServers: RTCIceServer[];
}
