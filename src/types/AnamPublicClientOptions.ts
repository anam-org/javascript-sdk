import { ApiOptions } from '../types';
import { VoiceDetectionOptions } from './VoiceDetectionOptions';

export interface AnamPublicClientOptions {
  api?: ApiOptions;
  voiceDetection?: VoiceDetectionOptions;
  audioDeviceId?: string;
  disableInputAudio?: boolean;
  metrics?: {
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
}
