import { ApiOptions } from '../types';
import { ConnectionMilestoneMetricsOptions } from './ConnectionMilestoneMetricsOptions';
import { VoiceDetectionOptions } from './VoiceDetectionOptions';
import { VisionClientOptions } from './vision/VisionInput';

export interface AnamPublicClientOptions {
  api?: ApiOptions;
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
  /**
   * Enables camera and screen input for vision analysis. When set, the SDK
   * negotiates one send-only video track per source up front, so sources can
   * be started and stopped later without renegotiating. Screen capture is
   * left out on devices that do not support it, such as mobile browsers.
   * Vision must also be enabled for the session.
   */
  vision?: VisionClientOptions;
}
