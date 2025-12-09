import { SignallingClient } from '../modules/SignallingClient';
import { AgentAudioInputConfig } from './signalling/AgentAudioInputConfig';
import { AgentAudioInputPayload } from './signalling/AgentAudioInputPayload';

export class AgentAudioInputStream {
  private signallingClient: SignallingClient;
  private config: AgentAudioInputConfig;

  constructor(
    config: AgentAudioInputConfig,
    signallingClient: SignallingClient,
  ) {
    this.config = config;
    this.signallingClient = signallingClient;
  }

  /**
   * Send PCM audio chunk to server.
   * @param audioData - Raw PCM audio bytes (ArrayBuffer/Uint8Array) or base64-encoded string
   */
  public sendAudioChunk(audioData: ArrayBuffer | Uint8Array | string): void {
    const base64 =
      typeof audioData === 'string'
        ? audioData
        : this.arrayBufferToBase64(audioData);

    const payload: AgentAudioInputPayload = {
      audioData: base64,
      encoding: this.config.encoding,
      sampleRate: this.config.sampleRate,
      channels: this.config.channels,
    };

    this.signallingClient.sendAgentAudioInput(payload);
  }

  /**
   * Signal end of the current audio sequence/turn.
   * Sends AGENT_AUDIO_INPUT_END signal message.
   */
  public endSequence(): void {
    this.signallingClient.sendAgentAudioInputEnd();
  }

  /**
   * Get the audio format configuration for this stream.
   */
  public getConfig(): AgentAudioInputConfig {
    return this.config;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
