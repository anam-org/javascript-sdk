export interface AgentAudioInputPayload {
  /** Base64-encoded PCM audio data */
  audioData: string;

  /** 'pcm_s16le' (16-bit signed) or 'pcm_f32le' (32-bit float) */
  encoding: 'pcm_s16le' | 'pcm_f32le';

  /** Sample rate in Hz (e.g., 16000, 24000, 44100) */
  sampleRate: number;

  /** 1 = mono, 2 = stereo */
  channels: number;

  /** Sequence number for ordering (starts at 0, resets on endSequence) */
  sequenceNumber: number;
}
