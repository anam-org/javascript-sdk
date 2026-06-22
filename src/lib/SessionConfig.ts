import { SessionConfigSignalPayload } from '../types';

export const buildRTCConfiguration = (
  rtcConfiguration: RTCConfiguration | undefined,
  iceServers: RTCIceServer[],
  sessionConfig?: SessionConfigSignalPayload,
): RTCConfiguration => {
  const serverIceServers = sessionConfig?.iceServers ?? iceServers;
  const serverIceTransportPolicy = sessionConfig?.iceTransportPolicy;

  return {
    ...rtcConfiguration,
    iceServers: serverIceServers,
    ...(serverIceTransportPolicy
      ? { iceTransportPolicy: serverIceTransportPolicy }
      : {}),
  };
};
