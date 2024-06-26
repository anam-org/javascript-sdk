import { Message, MessageStreamEvent } from '../messageHistory';
import { WebRtcTextMessageEvent } from './WebRtcTextMessageEvent';

export interface ConnectionCallbacks {
  onReceiveMessageCallback?: (messageEvent: WebRtcTextMessageEvent) => void;
  onMessageStreamEventCallback?: (messageEvent: MessageStreamEvent) => void;
  onMessageHistoryUpdatedCallback?: (messages: Message[]) => void;
  onConnectionEstablishedCallback?: () => void;
  onConnectionClosedCallback?: (reason: string) => void;
  onInputAudioStreamStartCallback?: (audioStream: MediaStream) => void;
  onVideoStreamStartCallback?: (videoStream: MediaStream) => void;
  onVideoPlayStartedCallback?: () => void;
  onAudioStreamStartCallback?: (audioStream: MediaStream) => void;
}
