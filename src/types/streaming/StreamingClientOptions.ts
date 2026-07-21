import { SignallingClientOptions } from '../../types';
import { EngineApiRestClientOptions } from '../engineApi/EngineApiRestClientOptions';
import { InputAudioOptions } from './InputAudioOptions';
import { ApiGatewayConfig } from '../ApiGatewayConfig';
import { TransparentBackgroundOptions } from '../TransparentBackgroundOptions';

export interface StreamingClientOptions {
  engine: EngineApiRestClientOptions;
  signalling: SignallingClientOptions;
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  rtcConfiguration?: RTCConfiguration;
  inputAudio: InputAudioOptions;
  apiGateway?: ApiGatewayConfig;
  transparentBackground?: {
    enabled: boolean;
    keyOptions?: TransparentBackgroundOptions;
  };
  metrics?: {
    showPeerConnectionStatsReport?: boolean;
    peerConnectionStatsReportOutputFormat?: 'console' | 'json';
  };
}
