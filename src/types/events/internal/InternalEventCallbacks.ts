import {
  InternalEvent,
  SignalMessage,
  WebRtcTextMessageEvent,
  WebRtcClientToolEvent,
  WebRtcReasoningTextMessageEvent,
} from '../../index';

export type InternalEventCallbacks = {
  [InternalEvent.WEB_SOCKET_OPEN]: () => void;
  [InternalEvent.SIGNAL_MESSAGE_RECEIVED]: (
    signalMessage: SignalMessage,
  ) => void;
  [InternalEvent.WEBRTC_CHAT_MESSAGE_RECEIVED]: (
    message: WebRtcTextMessageEvent,
  ) => void;
  [InternalEvent.WEBRTC_CLIENT_TOOL_EVENT_RECEIVED]: (
    webRtcToolEvent: WebRtcClientToolEvent,
  ) => void;
  [InternalEvent.WEBRTC_REASONING_TEXT_MESSAGE_RECEIVED]: (
    message: WebRtcReasoningTextMessageEvent,
  ) => void;
};
