import { TextMessageEvent } from './TextMessageEvent';

export interface ConnectionCallbacks {
  onReceiveMessageCallback?: (messageEvent: TextMessageEvent) => void;
  onConnectionEstablishedCallback?: () => void;
  onConnectionClosedCallback?: (reason: string) => void;
  onInputAudioStreamStartCallback?: (audioStream: MediaStream) => void;
  onVideoStreamStartCallback?: (videoStream: MediaStream) => void;
  onVideoPlayStartedCallback?: () => void;
  onAudioStreamStartCallback?: (audioStream: MediaStream) => void;
}
