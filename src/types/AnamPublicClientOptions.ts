import { ApiOptions } from '../types';
import { ConnectionMilestoneMetricsOptions } from './ConnectionMilestoneMetricsOptions';
import { VoiceDetectionOptions } from './VoiceDetectionOptions';
import { TransparentBackgroundOptions } from './TransparentBackgroundOptions';

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
   * Request the avatar's generated green-screen rendition and render it as a
   * transparent WebGL canvas over the video element supplied to
   * `streamToVideoElement`.
   *
   * The underlying MediaStream remains an ordinary opaque WebRTC video. Calls
   * to `stream()` therefore return the green-screen source; transparent pixels
   * exist only in the SDK-managed canvas renderer.
   * @default false
   */
  transparentBackground?: boolean;
  /** Optional client-side key tuning for `transparentBackground`. */
  transparentBackgroundOptions?: TransparentBackgroundOptions;
}
