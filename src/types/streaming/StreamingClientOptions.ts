import { SignallingClientOptions } from '../../types';
import { EngineApiRestClientOptions } from '../engineApi/EngineApiRestClientOptions';

export interface StreamingClientOptions {
  engine: EngineApiRestClientOptions;
  signalling: SignallingClientOptions;
}
