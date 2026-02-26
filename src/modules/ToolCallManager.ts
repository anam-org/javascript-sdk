import { ClientToolEvent, WebRtcClientToolEvent } from '../types/streaming';
import {
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallStartedPayload,
} from '../types/toolCalling/ToolCallPayload';
import {
  WebRtcToolCallCompletedEvent,
  WebRtcToolCallFailedEvent,
  WebRtcToolCallStartedEvent,
} from '../types/streaming/WebRtcToolCallEvent';
import { ToolCallHandler } from '../types/toolCalling/ToolCallHandler';
import { PublicEventEmitter } from './PublicEventEmitter';
import { AnamEvent } from '../types';

type PendingToolCall = {
  payload: ToolCallStartedPayload;
  timestamp: number;
};

const calculateExecutionTime = (
  startTimestamp: number,
  endTimestamp: number,
): number => {
  if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
    return 0;
  }
  const executionTime = endTimestamp - startTimestamp;
  return executionTime > 0 ? executionTime : 0;
};

export class ToolCallManager {
  private publicEventEmitter: PublicEventEmitter;
  private handlers: Record<string, ToolCallHandler> = Object.create(null);
  private pendingCalls: Record<string, PendingToolCall> = Object.create(null);

  constructor(publicEventEmitter: PublicEventEmitter) {
    this.publicEventEmitter = publicEventEmitter;
  }

  clearPendingCalls(): void {
    this.pendingCalls = Object.create(null);
  }

  registerHandler(toolName: string, handler: ToolCallHandler): () => void {
    this.handlers[toolName] = handler;

    return () => {
      delete this.handlers[toolName];
    };
  }

  async processToolCallStartedEvent(toolCallEvent: WebRtcToolCallStartedEvent) {
    const { tool_name, timestamp } = toolCallEvent;

    const payload =
      this.WebRTCToolCallStartedEventToToolCallStartedPayload(toolCallEvent);

    const parsedTimestamp = new Date(timestamp);

    // Store in pending calls before invoking handlers
    this.pendingCalls[toolCallEvent.tool_call_id] = {
      payload: payload,
      timestamp: parsedTimestamp.getTime(),
    };

    if (!(tool_name in this.handlers)) {
      return;
    }

    const handler = this.handlers[tool_name];

    if (!handler.onStart) {
      return;
    }

    try {
      let result = await handler.onStart(payload);
      if (toolCallEvent.tool_type === 'client') {
        await this.processToolCallCompletedEvent({
          ...toolCallEvent,
          result: result,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    } catch (error) {
      if (error instanceof Error) {
        await this.processToolCallFailedEvent({
          ...toolCallEvent,
          error_message: `Error in onStart handler: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
      } else {
        await this.processToolCallFailedEvent({
          ...toolCallEvent,
          error_message: `Error in onStart handler: ${String(error)}`,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }
  }

  async processToolCallCompletedEvent(
    toolCallEvent: WebRtcToolCallCompletedEvent,
  ) {
    const { tool_name, tool_call_id, timestamp } = toolCallEvent;

    const payload =
      this.webRTCToolCallCompletedEventToToolCallCompletedPayload(
        toolCallEvent,
      );

    if (tool_call_id in this.pendingCalls) {
      // Clean up pending call
      delete this.pendingCalls[tool_call_id];
    }

    if (!(tool_name in this.handlers)) {
      return;
    }

    const handler = this.handlers[tool_name];

    if (!handler.onComplete) {
      return;
    }

    if (toolCallEvent.tool_type === 'client') {
      this.publicEventEmitter.emit(AnamEvent.TOOL_CALL_COMPLETED, payload);
    }

    try {
      await handler.onComplete(payload);
    } catch (error) {
      console.error(
        `Error in onComplete handler for tool ${tool_name}:`,
        error,
      );
      return;
    }
  }

  async processToolCallFailedEvent(toolCallEvent: WebRtcToolCallFailedEvent) {
    const { tool_name, tool_call_id, timestamp } = toolCallEvent;

    const payload =
      this.webRTCToolCallFailedEventToToolCallFailedPayload(toolCallEvent);

    if (tool_call_id in this.pendingCalls) {
      delete this.pendingCalls[tool_call_id];
    }

    if (!(tool_name in this.handlers)) {
      return;
    }

    const handler = this.handlers[tool_name];

    if (!handler.onFail) {
      return;
    }

    if (toolCallEvent.tool_type === 'client') {
      this.publicEventEmitter.emit(AnamEvent.TOOL_CALL_FAILED, payload);
    }

    try {
      await handler.onFail(payload);
    } catch (error) {
      console.error(`Error in onFail handler for tool ${tool_name}:`, error);
      return;
    }
  }

  /**
   * Converts a WebRtcClientToolEvent to a ClientToolEvent
   */
  static WebRTCClientToolEventToClientToolEvent(
    webRtcEvent: WebRtcClientToolEvent,
  ): ClientToolEvent {
    return {
      eventUid: webRtcEvent.event_uid,
      sessionId: webRtcEvent.session_id,
      eventName: webRtcEvent.event_name,
      eventData: webRtcEvent.event_data,
      timestamp: webRtcEvent.timestamp,
      timestampUserAction: webRtcEvent.timestamp_user_action,
      userActionCorrelationId: webRtcEvent.user_action_correlation_id,
    };
  }

  static WebRTCToolCallStartedEventToClientToolEvent(
    webRtcEvent: WebRtcToolCallStartedEvent,
  ): ClientToolEvent {
    return {
      eventUid: webRtcEvent.event_uid,
      sessionId: webRtcEvent.session_id,
      eventName: webRtcEvent.tool_name,
      eventData: webRtcEvent.arguments,
      timestamp: webRtcEvent.timestamp,
      timestampUserAction: webRtcEvent.timestamp_user_action,
      userActionCorrelationId: webRtcEvent.user_action_correlation_id,
    };
  }

  WebRTCToolCallStartedEventToToolCallStartedPayload(
    webRtcEvent: WebRtcToolCallStartedEvent,
  ): ToolCallStartedPayload {
    return {
      eventUid: webRtcEvent.event_uid,
      toolCallId: webRtcEvent.tool_call_id,
      toolName: webRtcEvent.tool_name,
      toolType: webRtcEvent.tool_type,
      toolSubtype: webRtcEvent.tool_subtype,
      arguments: webRtcEvent.arguments,
      timestamp: webRtcEvent.timestamp,
    };
  }

  webRTCToolCallCompletedEventToToolCallCompletedPayload(
    webRtcEvent: WebRtcToolCallCompletedEvent,
  ): ToolCallCompletedPayload {
    const parsedTimestamp = new Date(webRtcEvent.timestamp);
    const pendingCall = this.pendingCalls[webRtcEvent.tool_call_id];
    const executionTime = pendingCall
      ? calculateExecutionTime(pendingCall.timestamp, parsedTimestamp.getTime())
      : 0;

    return {
      eventUid: webRtcEvent.event_uid,
      toolCallId: webRtcEvent.tool_call_id,
      toolName: webRtcEvent.tool_name,
      toolType: webRtcEvent.tool_type,
      toolSubtype: webRtcEvent.tool_subtype,
      result: webRtcEvent.result,
      executionTime: executionTime > 0 ? executionTime : 0,
      timestamp: webRtcEvent.timestamp,
      documentsAccessed: webRtcEvent.documents_accessed, // Include accessed files if present
    };
  }

  webRTCToolCallFailedEventToToolCallFailedPayload(
    webRtcEvent: WebRtcToolCallFailedEvent,
  ): ToolCallFailedPayload {
    const parsedTimestamp = new Date(webRtcEvent.timestamp);
    const pendingCall = this.pendingCalls[webRtcEvent.tool_call_id];
    const executionTime = pendingCall
      ? calculateExecutionTime(pendingCall.timestamp, parsedTimestamp.getTime())
      : 0;

    return {
      eventUid: webRtcEvent.event_uid,
      toolCallId: webRtcEvent.tool_call_id,
      toolName: webRtcEvent.tool_name,
      toolType: webRtcEvent.tool_type,
      toolSubtype: webRtcEvent.tool_subtype,
      errorMessage: webRtcEvent.error_message,
      executionTime: executionTime > 0 ? executionTime : 0,
      timestamp: webRtcEvent.timestamp,
    };
  }
}
