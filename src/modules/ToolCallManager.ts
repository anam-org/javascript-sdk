import { ClientToolEvent, WebRtcClientToolEvent } from '../types/streaming';
import {
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallResultReceivedPayload,
  ToolCallStartedPayload,
} from '../types/toolCalling/ToolCallPayload';
import {
  WebRtcToolCallCompletedEvent,
  WebRtcToolCallFailedEvent,
  WebRtcToolCallStartedEvent,
} from '../types/streaming/WebRtcToolCallEvent';
import { ToolCallHandler } from '../types/toolCalling/ToolCallHandler';
import { InternalEventEmitter } from './InternalEventEmitter';
import { PublicEventEmitter } from './PublicEventEmitter';
import { AnamEvent, InternalEvent } from '../types';

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
  private internalEventEmitter: InternalEventEmitter;
  private handlers: Record<string, ToolCallHandler> = Object.create(null);
  private pendingCalls: Record<string, PendingToolCall> = Object.create(null);
  private failedCalls: Record<string, ToolCallFailedPayload> =
    Object.create(null);
  private completedCalls: Record<string, true> = Object.create(null);
  private activeSessionId: string | null = null;

  constructor(
    publicEventEmitter: PublicEventEmitter,
    internalEventEmitter: InternalEventEmitter,
  ) {
    this.publicEventEmitter = publicEventEmitter;
    this.internalEventEmitter = internalEventEmitter;
  }

  setActiveSession(sessionId: string): void {
    this.activeSessionId = sessionId;
    this.clearPendingCalls();
    this.clearFailedCalls();
    this.clearCompletedCalls();
  }

  clearSessionState(): void {
    this.activeSessionId = null;
    this.clearPendingCalls();
    this.clearFailedCalls();
    this.clearCompletedCalls();
  }

  clearPendingCalls(): void {
    this.pendingCalls = Object.create(null);
  }

  clearFailedCalls(): void {
    this.failedCalls = Object.create(null);
  }

  clearCompletedCalls(): void {
    this.completedCalls = Object.create(null);
  }

  registerHandler(toolName: string, handler: ToolCallHandler): () => void {
    this.handlers[toolName] = handler;

    return () => {
      delete this.handlers[toolName];
    };
  }

  async processToolCallStartedEvent(toolCallEvent: WebRtcToolCallStartedEvent) {
    if (this.activeSessionId !== toolCallEvent.session_id) {
      return;
    }

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
        this.sendToolResult({
          sessionId: toolCallEvent.session_id,
          toolCallId: toolCallEvent.tool_call_id,
          userActionCorrelationId: toolCallEvent.user_action_correlation_id,
          timestampUserAction: toolCallEvent.timestamp_user_action,
          result: result ?? undefined,
          errorMessage: undefined,
        });
        await this.processToolCallCompletedEvent({
          ...toolCallEvent,
          result: result,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (toolCallEvent.tool_type === 'client') {
        this.sendToolResult({
          sessionId: toolCallEvent.session_id,
          toolCallId: toolCallEvent.tool_call_id,
          userActionCorrelationId: toolCallEvent.user_action_correlation_id,
          timestampUserAction: toolCallEvent.timestamp_user_action,
          result: undefined,
          errorMessage: `Error in handler: ${errorMessage}`,
        });
      }
      await this.processToolCallFailedEvent({
        ...toolCallEvent,
        error_message: `Error in onStart handler: ${errorMessage}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }

  async processToolCallCompletedEvent(
    toolCallEvent: WebRtcToolCallCompletedEvent,
  ) {
    const { tool_name, tool_call_id, timestamp } = toolCallEvent;

    if (this.activeSessionId !== toolCallEvent.session_id) {
      return;
    }

    if (tool_call_id in this.failedCalls) {
      // If this call was previously marked as failed, do not process it as completed
      delete this.failedCalls[tool_call_id]; // Clean up failed call record
      return;
    }

    if (tool_call_id in this.completedCalls) {
      // Already processed: for client tools we synthesize completion locally after the
      // handler runs, and the engine may also send a completed event for the same call
      // (e.g. ElevenLabs agent tool forwarding). First outcome wins.
      return;
    }
    this.completedCalls[tool_call_id] = true;

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

    if (this.activeSessionId !== toolCallEvent.session_id) {
      return;
    }

    if (
      tool_call_id in this.failedCalls ||
      tool_call_id in this.completedCalls
    ) {
      // Already processed: for client tools we synthesize failure locally when the
      // handler throws, and the engine may also send a failed event for the same call
      // (e.g. ElevenLabs agent tool forwarding). First outcome wins.
      return;
    }

    const payload =
      this.webRTCToolCallFailedEventToToolCallFailedPayload(toolCallEvent);

    // Mark the call as failed
    this.failedCalls[tool_call_id] = payload;

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
   * Emits a tool result event so it can be sent back to the engine.
   * The StreamingClient listens for this event and sends the data channel message.
   */
  sendToolResult(result: {
    sessionId: string;
    toolCallId: string;
    userActionCorrelationId: string;
    timestampUserAction: string;
    result?: string;
    errorMessage?: string;
  }): void {
    const payload: ToolCallResultReceivedPayload = {
      sessionId: result.sessionId,
      toolCallId: result.toolCallId,
      result: result.result,
      errorMessage: result.errorMessage,
      userActionCorrelationId: result.userActionCorrelationId,
      timestampUserAction: result.timestampUserAction,
    };
    this.internalEventEmitter.emit(
      InternalEvent.TOOL_CALL_RESULT_READY,
      payload,
    );
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
      sessionId: webRtcEvent.session_id,
      toolCallId: webRtcEvent.tool_call_id,
      toolName: webRtcEvent.tool_name,
      toolType: webRtcEvent.tool_type,
      toolSubtype: webRtcEvent.tool_subtype,
      arguments: webRtcEvent.arguments,
      timestamp: webRtcEvent.timestamp,
      timestampUserAction: webRtcEvent.timestamp_user_action,
      userActionCorrelationId: webRtcEvent.user_action_correlation_id,
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
      sessionId: webRtcEvent.session_id,
      toolCallId: webRtcEvent.tool_call_id,
      toolName: webRtcEvent.tool_name,
      toolType: webRtcEvent.tool_type,
      toolSubtype: webRtcEvent.tool_subtype,
      result: webRtcEvent.result,
      executionTime: executionTime > 0 ? executionTime : 0,
      timestamp: webRtcEvent.timestamp,
      documentsAccessed: webRtcEvent.documents_accessed, // Include accessed files if present
      timestampUserAction: webRtcEvent.timestamp_user_action,
      userActionCorrelationId: webRtcEvent.user_action_correlation_id,
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
      sessionId: webRtcEvent.session_id,
      toolCallId: webRtcEvent.tool_call_id,
      toolName: webRtcEvent.tool_name,
      toolType: webRtcEvent.tool_type,
      toolSubtype: webRtcEvent.tool_subtype,
      errorMessage: webRtcEvent.error_message,
      executionTime: executionTime > 0 ? executionTime : 0,
      timestamp: webRtcEvent.timestamp,
      timestampUserAction: webRtcEvent.timestamp_user_action,
      userActionCorrelationId: webRtcEvent.user_action_correlation_id,
    };
  }
}
