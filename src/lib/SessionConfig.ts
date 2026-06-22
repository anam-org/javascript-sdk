import { SessionConfigSignalPayload } from '../types';

export const buildRTCConfiguration = (
  rtcConfiguration: RTCConfiguration | undefined,
  sessionConfig?: SessionConfigSignalPayload,
): RTCConfiguration => {
  const serverIceServers = sessionConfig?.iceServers;
  const serverIceTransportPolicy = sessionConfig?.iceTransportPolicy;

  return {
    ...rtcConfiguration,
    ...(serverIceServers ? { iceServers: serverIceServers } : {}),
    ...(serverIceTransportPolicy
      ? { iceTransportPolicy: serverIceTransportPolicy }
      : {}),
  };
};
