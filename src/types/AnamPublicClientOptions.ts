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
  };
  iceServers?: RTCIceServer[];
}
