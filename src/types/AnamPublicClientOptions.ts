import { ApiOptions } from '../types';
import { VoiceDetectionOptions } from './VoiceDetectionOptions';

export interface AnamPublicClientOptions {
  api?: ApiOptions;
  voiceDetection?: VoiceDetectionOptions;
  audioDeviceId?: string;
  disableInputAudio?: boolean;
  transport?: {
    mode?: 'direct' | 'proxy';
    proxy?: {
      baseUrl: string; // e.g., window.location.origin
      startSessionPath?: string; // default '/v1/auth/session'
      agentWsPathTemplate?: string; // e.g., '/v1/agents/{userId}/ws'
      getUserId: () => string;
      headers?: Record<string, string>;
    };
  };
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
