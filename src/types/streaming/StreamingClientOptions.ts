import { SignallingClientOptions } from '../../types';
import { EngineApiRestClientOptions } from '../engineApi/EngineApiRestClientOptions';
import { InputAudioOptions } from './InputAudioOptions';
import { ApiGatewayConfig } from '../ApiGatewayConfig';
import { VisionClientOptions } from '../vision/VisionInput';

export interface StreamingClientOptions {
  engine: EngineApiRestClientOptions;
  signalling: SignallingClientOptions;
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  rtcConfiguration?: RTCConfiguration;
  inputAudio: InputAudioOptions;
  apiGateway?: ApiGatewayConfig;
  vision?: VisionClientOptions;
  metrics?: {
    showPeerConnectionStatsReport?: boolean;
    peerConnectionStatsReportOutputFormat?: 'console' | 'json';
  };
}
