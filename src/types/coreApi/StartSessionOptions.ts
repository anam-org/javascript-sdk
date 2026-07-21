import { VoiceDetectionOptions } from '../VoiceDetectionOptions';
import { TransparentBackgroundTransport } from '../TransparentBackgroundTransport';

export interface StartSessionOptions {
  voiceDetection?: VoiceDetectionOptions;
  /**
   * Selects the avatar's private green-screen rendition for this session.
   * The JavaScript SDK separately composites that rendition into a transparent
   * canvas when streaming to a video element.
   */
  transparentBackground?: boolean;
  /**
   * Selects the internal wire representation used for transparent video.
   * @internal
   */
  transparentBackgroundTransport?: TransparentBackgroundTransport;
}
