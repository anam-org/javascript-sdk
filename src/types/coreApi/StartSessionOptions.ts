import { VoiceDetectionOptions } from '../VoiceDetectionOptions';

/**
 * Requested engine region. Known values today are `'eu'` and `'us'`;
 * additional regions may be introduced over time.
 */
// eslint-disable-next-line @typescript-eslint/ban-types -- preserves autocomplete while accepting future region strings
export type SessionRegion = 'eu' | 'us' | (string & {});
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
