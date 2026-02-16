import { ConnectionClosedCode } from './ConnectionClosedCodes';
import {
  Message,
  MessageStreamEvent,
  AnamEvent,
  ClientToolEvent,
  ReasoningMessage,
  ReasoningStreamEvent,
  ToolCallFailedPayload,
  ToolCallCompletedPayload,
  ToolCallStartedPayload,
} from '../../index';

export type EventCallbacks = {
  [AnamEvent.MESSAGE_HISTORY_UPDATED]: (messages: Message[]) => void;
  [AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED]: (
    messageEvent: MessageStreamEvent,
  ) => void;
  [AnamEvent.CONNECTION_ESTABLISHED]: () => void;
  [AnamEvent.CONNECTION_CLOSED]: (
    reason: ConnectionClosedCode,
    details?: string,
  ) => void;
  [AnamEvent.INPUT_AUDIO_STREAM_STARTED]: (audioStream: MediaStream) => void;
  [AnamEvent.VIDEO_STREAM_STARTED]: (videoStream: MediaStream) => void;
  [AnamEvent.VIDEO_PLAY_STARTED]: () => void;
  [AnamEvent.AUDIO_STREAM_STARTED]: (audioStream: MediaStream) => void;
  [AnamEvent.TALK_STREAM_INTERRUPTED]: (correlationId: string) => void;
  [AnamEvent.SESSION_READY]: (sessionId: string) => void;
  [AnamEvent.SERVER_WARNING]: (message: string) => void;
  [AnamEvent.MIC_PERMISSION_PENDING]: () => void;
  [AnamEvent.MIC_PERMISSION_GRANTED]: () => void;
  [AnamEvent.MIC_PERMISSION_DENIED]: (error: string) => void;
  [AnamEvent.INPUT_AUDIO_DEVICE_CHANGED]: (deviceId: string) => void;
  [AnamEvent.CLIENT_TOOL_EVENT_RECEIVED]: (
    clientToolEvent: ClientToolEvent,
  ) => void;
  [AnamEvent.TOOL_CALL_STARTED_EVENT_RECEIVED]: (
    toolCallEvent: ToolCallStartedPayload,
  ) => void;
  [AnamEvent.TOOL_CALL_COMPLETED_EVENT_RECEIVED]: (
    toolCallEvent: ToolCallCompletedPayload,
  ) => void;
  [AnamEvent.TOOL_CALL_FAILED_EVENT_RECEIVED]: (
    toolCallEvent: ToolCallFailedPayload,
  ) => void;
  [AnamEvent.REASONING_HISTORY_UPDATED]: (
    thoughtMessages: ReasoningMessage[],
  ) => void;
  [AnamEvent.REASONING_STREAM_EVENT_RECEIVED]: (
    thoughtEvent: ReasoningStreamEvent,
  ) => void;
};
