import {
  InternalEvent,
  SignalMessage,
  WebRtcTextMessageEvent,
  WebRtcClientToolEvent,
  WebRtcReasoningTextMessageEvent,
} from '../../index';
import {
  WebRtcToolCallCompletedEvent,
  WebRtcToolCallFailedEvent,
  WebRtcToolCallStartedEvent,
} from '../../streaming/WebRtcToolCallEvent';

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
  [InternalEvent.WEBRTC_TOOL_CALL_STARTED_EVENT_RECEIVED]: (
    webRtcToolEvent: WebRtcToolCallStartedEvent,
  ) => void;
  [InternalEvent.WEBRTC_TOOL_CALL_COMPLETED_EVENT_RECEIVED]: (
    webRtcToolEvent: WebRtcToolCallCompletedEvent,
  ) => void;
  [InternalEvent.WEBRTC_TOOL_CALL_FAILED_EVENT_RECEIVED]: (
    webRtcToolEvent: WebRtcToolCallFailedEvent,
  ) => void;
  [InternalEvent.WEBRTC_REASONING_TEXT_MESSAGE_RECEIVED]: (
    message: WebRtcReasoningTextMessageEvent,
  ) => void;
};
