import { ClientToolEvent, WebRtcClientToolEvent } from '../types/streaming';
import {
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallStartedPayload,
} from '../types/streaming/ToolCallEvents';
import {
  WebRtcToolCallCompletedEvent,
  WebRtcToolCallFailedEvent,
  WebRtcToolCallStartedEvent,
} from '../types/streaming/WebRtcToolCallEvent';

export interface ToolCallHandler {
  onStart?: (payload: ToolCallStartedPayload) => Promise<void>;
  onFail?: (payload: ToolCallFailedPayload) => Promise<void>;
  onComplete?: (payload: ToolCallCompletedPayload) => Promise<void>;
}

type PendingToolCall = {
  payload: ToolCallStartedPayload;
  timestamp: number;
};

export class ToolCallManager {
  private handlers: Record<string, Record<string, ToolCallHandler>> = {};
  private genericHandlers: Record<string, ToolCallHandler> = {};
  private pendingCalls: Record<string, PendingToolCall> = {};

  registerHandler(eventName: string, handler: ToolCallHandler): () => void {
    const handlerId = Math.random().toString(36).substring(2, 15);

    if (eventName === '*') {
      this.genericHandlers[handlerId] = handler;
      return () => {
        delete this.genericHandlers[handlerId];
      };
    }

    this.handlers[eventName] = {
      ...this.handlers[eventName],
      [handlerId]: handler,
    };

    return () => {
      delete this.handlers[eventName][handlerId];
    };
  }

  async processToolCallStartedEvent(toolCallEvent: WebRtcToolCallStartedEvent) {
    const { tool_name, timestamp } = toolCallEvent;

    const handlersForTool = this.handlers[tool_name] || {};
    const handlers = Object.values(handlersForTool);
    const genericHandlers = Object.values(this.genericHandlers);

    const payload: ToolCallStartedPayload = {
      eventUid: toolCallEvent.event_uid,
      toolCallId: toolCallEvent.tool_call_id,
      toolName: toolCallEvent.tool_name,
      toolType: toolCallEvent.tool_type,
      toolSubtype: toolCallEvent.tool_subtype,
      arguments: toolCallEvent.arguments,
      timestamp: toolCallEvent.timestamp,
    };

    const parsedTimestamp = new Date(timestamp);

    // Store in pending calls before invoking handlers
    this.pendingCalls[toolCallEvent.tool_call_id] = {
      payload: payload,
      timestamp: parsedTimestamp.getTime(),
    };

    const errors: Error[] = [];

    await this.invokeAll(
      genericHandlers
        .filter((handler) => handler.onStart)
        .map((handler) => handler.onStart!(payload)),
      errors,
    );

    await this.invokeAll(
      handlers
        .filter((handler) => handler.onStart)
        .map((handler) => handler.onStart!(payload)),
      errors,
    );

    if (errors.length > 0) {
      const combinedMessage = errors.map((e) => e.message).join('; ');
      await this.processToolCallFailedEvent({
        ...toolCallEvent,
        error_message: `Error in onStart handler: ${combinedMessage}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (toolCallEvent.tool_type === 'client') {
      await this.processToolCallCompletedEvent({
        ...toolCallEvent,
        result: null,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async processToolCallCompletedEvent(
    toolCallEvent: WebRtcToolCallCompletedEvent,
  ) {
    const { tool_name, tool_call_id, timestamp } = toolCallEvent;

    const handlersForTool = this.handlers[tool_name] || {};
    const handlers = Object.values(handlersForTool);
    const genericHandlers = Object.values(this.genericHandlers);
    const parsedTimestamp = new Date(timestamp);

    const pendingCall = this.pendingCalls[tool_call_id];
    const executionTime = pendingCall
      ? parsedTimestamp.getTime() - pendingCall.timestamp
      : 0;

    const payload: ToolCallCompletedPayload = {
      eventUid: toolCallEvent.event_uid,
      toolCallId: toolCallEvent.tool_call_id,
      toolName: toolCallEvent.tool_name,
      toolType: toolCallEvent.tool_type,
      toolSubtype: toolCallEvent.tool_subtype,
      result: toolCallEvent.result,
      executionTime: executionTime,
      timestamp: toolCallEvent.timestamp,
    };

    const errors: Error[] = [];

    await this.invokeAll(
      genericHandlers
        .filter((handler) => handler.onComplete)
        .map((handler) => handler.onComplete!(payload)),
      errors,
    );

    await this.invokeAll(
      handlers
        .filter((handler) => handler.onComplete)
        .map((handler) => handler.onComplete!(payload)),
      errors,
    );

    if (errors.length > 0) {
      const combinedMessage = errors.map((e) => e.message).join('; ');
      await this.processToolCallFailedEvent({
        ...toolCallEvent,
        error_message: `Error in onComplete handler: ${combinedMessage}`,
        timestamp: new Date().toISOString(),
      });
    }

    if (pendingCall) {
      // Clean up pending call
      delete this.pendingCalls[tool_call_id];
    }
  }

  async processToolCallFailedEvent(toolCallEvent: WebRtcToolCallFailedEvent) {
    const { tool_name, tool_call_id, timestamp } = toolCallEvent;

    const handlersForTool = this.handlers[tool_name] || {};
    const handlers = Object.values(handlersForTool);
    const genericHandlers = Object.values(this.genericHandlers);
    const parsedTimestamp = new Date(timestamp);
    const pendingCall = this.pendingCalls[tool_call_id];
    const executionTime = pendingCall
      ? parsedTimestamp.getTime() - pendingCall.timestamp
      : 0;

    const payload: ToolCallFailedPayload = {
      eventUid: toolCallEvent.event_uid,
      toolCallId: toolCallEvent.tool_call_id,
      toolName: toolCallEvent.tool_name,
      toolType: toolCallEvent.tool_type,
      toolSubtype: toolCallEvent.tool_subtype,
      errorMessage: toolCallEvent.error_message,
      executionTime: executionTime,
      timestamp: toolCallEvent.timestamp,
    };

    await this.invokeAll(
      genericHandlers
        .filter((handler) => handler.onFail)
        .map((handler) => handler.onFail!(payload)),
    );

    await this.invokeAll(
      handlers
        .filter((handler) => handler.onFail)
        .map((handler) => handler.onFail!(payload)),
    );

    if (pendingCall) {
      // Clean up pending call
      delete this.pendingCalls[tool_call_id];
    }
  }

  private async invokeAll(
    promises: Array<Promise<void>>,
    errors?: Error[],
  ): Promise<void> {
    const results = await Promise.allSettled(promises);
    if (errors) {
      for (const result of results) {
        if (result.status === 'rejected') {
          errors.push(
            result.reason instanceof Error
              ? result.reason
              : new Error(String(result.reason)),
          );
        }
      }
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

  static WebRTCToolCallCompletedEventToClientToolEvent(
    webRtcEvent: WebRtcToolCallCompletedEvent,
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
}
