import { SignallingClientOptions } from '../../types';
import { EngineApiRestClientOptions } from '../engineApi/EngineApiRestClientOptions';
import { InputAudioOptions } from './InputAudioOptions';

export interface StreamingClientOptions {
  engine: EngineApiRestClientOptions;
  signalling: SignallingClientOptions;
  iceServers: RTCIceServer[];
  inputAudio: InputAudioOptions;
}
