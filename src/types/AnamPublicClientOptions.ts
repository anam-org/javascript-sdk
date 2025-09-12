import { CoreApiRestClientOptions } from '../types';
import { VoiceDetectionOptions } from './VoiceDetectionOptions';
export interface AnamPublicClientOptions {
  api?: CoreApiRestClientOptions;
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
  };
}
