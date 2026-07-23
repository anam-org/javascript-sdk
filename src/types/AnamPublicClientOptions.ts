import { ApiOptions } from '../types';
import { ConnectionMilestoneMetricsOptions } from './ConnectionMilestoneMetricsOptions';
import { VoiceDetectionOptions } from './VoiceDetectionOptions';

export interface AnamPublicClientOptions {
  api?: ApiOptions;
  voiceDetection?: VoiceDetectionOptions;
  /**
   * Show the AI avatar disclosure throughout the session.
   * Omit to use Anam's default. Explicit false requires an eligible plan.
   */
  showAiAvatarDisclosure?: boolean;
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
