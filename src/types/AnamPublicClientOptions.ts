import { ApiOptions } from '../types';
import { SessionOptions } from './coreApi/SessionOptions';
import { ConnectionMilestoneMetricsOptions } from './ConnectionMilestoneMetricsOptions';
import { VoiceDetectionOptions } from './VoiceDetectionOptions';

export interface AnamPublicClientOptions {
  api?: ApiOptions;
  /**
   * Session options (e.g. output `videoWidth`/`videoHeight`) applied when this
   * client mints its own session token — i.e. only used with
   * `unsafe_createClientWithApiKey`. When you create the token server-side, set
   * these on that request instead. See {@link SessionOptions}.
   */
  sessionOptions?: SessionOptions;
  voiceDetection?: VoiceDetectionOptions;
  audioDeviceId?: string;
  disableInputAudio?: boolean;
  metrics?: ConnectionMilestoneMetricsOptions & {
    showPeerConnectionStatsReport?: boolean;
    peerConnectionStatsReportOutputFormat?: 'console' | 'json';
    /**
     * When true, disables sending client metrics to Anam's telemetry endpoint.
     * Useful for privacy-conscious deployments or air-gapped environments.
     * @default false
     */
    disableClientMetrics?: boolean;
  };
  iceServers?: RTCIceServer[];
  /**
   * Full RTCConfiguration passed through to the underlying RTCPeerConnection.
   * Use e.g. `{ iceTransportPolicy: 'relay' }` to force TURN-relay-only on
   * networks that drop UDP. The top-level `iceServers` option (when set) takes
   * precedence over `rtcConfiguration.iceServers`.
   */
  rtcConfiguration?: RTCConfiguration;
}
