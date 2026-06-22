export interface BuildRTCConfigurationOptions {
  callerIceServers?: RTCIceServer[];
  defaultIceServers: RTCIceServer[];
  serverIceServers?: RTCIceServer[];
  serverIceTransportPolicy?: RTCIceTransportPolicy;
}

export const buildRTCConfiguration = (
  rtcConfiguration: RTCConfiguration | undefined,
  options: BuildRTCConfigurationOptions,
): RTCConfiguration => {
  const iceServers =
    options.callerIceServers ??
    rtcConfiguration?.iceServers ??
    options.serverIceServers ??
    options.defaultIceServers;
  const iceTransportPolicy =
    rtcConfiguration?.iceTransportPolicy ?? options.serverIceTransportPolicy;

  return {
    ...rtcConfiguration,
    iceServers,
    ...(iceTransportPolicy ? { iceTransportPolicy } : {}),
  };
};
