import { VoiceDetectionOptions } from '../VoiceDetectionOptions';

export type SessionRegion = 'eu' | 'us';
export type SessionRegionPolicy = 'preferred' | 'strict';

export interface SessionRegionOptions {
  region: SessionRegion;
  regionPolicy?: SessionRegionPolicy;
}

export interface StartSessionOptions {
  voiceDetection?: VoiceDetectionOptions;
  region?: SessionRegion;
  regionPolicy?: SessionRegionPolicy;
}
