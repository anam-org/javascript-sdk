import { SignallingClientOptions } from '../../types';
import { EngineApiRestClientOptions } from '../engineApi/EngineApiRestClientOptions';
import { InputAudioOptions } from './InputAudioOptions';
import { ProxyConfig } from '../ProxyConfig';

export interface StreamingClientOptions {
  engine: EngineApiRestClientOptions;
  signalling: SignallingClientOptions;
  iceServers: RTCIceServer[];
  inputAudio: InputAudioOptions;
  proxy?: ProxyConfig;
  metrics?: {
    showPeerConnectionStatsReport?: boolean;
    peerConnectionStatsReportOutputFormat?: 'console' | 'json';
  };
}
