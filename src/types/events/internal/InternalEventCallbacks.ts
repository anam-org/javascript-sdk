import {
  InternalEvent,
  SignalMessage,
  WebRtcTextMessageEvent,
} from '../../index';

export type InternalEventCallbacks = {
  [InternalEvent.WEB_SOCKET_OPEN]: () => void;
  [InternalEvent.SIGNAL_MESSAGE_RECEIVED]: (
    signalMessage: SignalMessage,
  ) => void;
  [InternalEvent.WEBRTC_CHAT_MESSAGE_RECEIVED]: (
    message: WebRtcTextMessageEvent,
  ) => void;
};
