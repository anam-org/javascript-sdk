import { VoiceDetectionOptions } from '../VoiceDetectionOptions';

export interface StartSessionOptions {
  voiceDetection?: VoiceDetectionOptions;
  /**
   * Selects the avatar's private green-screen rendition for this session.
   * The JavaScript SDK separately composites that rendition into a transparent
   * canvas when streaming to a video element.
   */
  transparentBackground?: boolean;
}
