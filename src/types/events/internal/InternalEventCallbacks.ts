import {
  InternalEvent,
  SignalMessage,
  WebRtcTextMessageEvent,
  ToolCallEvent,
  ClientEventEvent,
} from '../../index';

export type InternalEventCallbacks = {
  [InternalEvent.WEB_SOCKET_OPEN]: () => void;
  [InternalEvent.SIGNAL_MESSAGE_RECEIVED]: (
    signalMessage: SignalMessage,
  ) => void;
  [InternalEvent.WEBRTC_CHAT_MESSAGE_RECEIVED]: (
    message: WebRtcTextMessageEvent,
  ) => void;
  [InternalEvent.WEBRTC_TOOL_CALL_RECEIVED]: (toolCall: ToolCallEvent) => void;
  [InternalEvent.WEBRTC_CLIENT_EVENT_RECEIVED]: (
    clientEvent: ClientEventEvent,
  ) => void;
};
