import { CoreApiRestClientOptions } from '../types';
import { VoiceDetectionOptions } from './VoiceDetectionOptions';
export interface AnamPublicClientOptions {
  api?: CoreApiRestClientOptions;
  voiceDetection?: VoiceDetectionOptions;
  audioDeviceId?: string;
  disableInputAudio?: boolean;
  metrics?: {
    showPeerConnectionStatsReport?: boolean;
    peerConnectionStatsReportOutputFormat?: 'console' | 'json';
  };
}
