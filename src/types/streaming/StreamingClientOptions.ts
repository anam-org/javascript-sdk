import { SignallingClientOptions } from '../../types';
import { EngineApiRestClientOptions } from '../engineApi/EngineApiRestClientOptions';
import { InputAudioOptions } from './InputAudioOptions';
import { ApiGatewayConfig } from '../ApiGatewayConfig';
import { TransparentBackgroundOptions } from '../TransparentBackgroundOptions';
import { TransparentBackgroundTransport } from '../TransparentBackgroundTransport';

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
    transport?: TransparentBackgroundTransport;
  };
  metrics?: {
    showPeerConnectionStatsReport?: boolean;
    peerConnectionStatsReportOutputFormat?: 'console' | 'json';
  };
}
