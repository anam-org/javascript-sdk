import { CoreApiRestClientOptions } from '../types';
import { VoiceDetectionOptions } from './VoiceDetectionOptions';
import { PersonaConfig } from './PersonaConfig';

export interface AnamPublicClientOptions {
  api?: CoreApiRestClientOptions;
  voiceDetection?: VoiceDetectionOptions;
  audioDeviceId?: string;
  disableInputAudio?: boolean;
  /**
   * The persona configuration to use.
   * This is the recommended way to pass persona configuration instead of using the deprecated personaConfig parameter.
   */
  personaConfig?: PersonaConfig;
}
