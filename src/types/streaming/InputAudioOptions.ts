import { InputAudioState } from '../InputAudioState';

export interface InputAudioOptions {
  inputAudioState: InputAudioState;
  userProvidedMediaStream?: MediaStream;
}
