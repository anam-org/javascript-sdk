export interface AgentAudioInputConfig {
  /** 'pcm_s16le' (16-bit signed) **/
  encoding: 'pcm_s16le';

  /** Sample rate in Hz (e.g., 16000, 24000, 44100) */
  sampleRate: number;

  /** 1 = mono, 2 = stereo */
  channels: number;
}
