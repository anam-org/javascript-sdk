import {
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallStartedPayload,
} from './ToolCallPayload';

export interface ToolCallHandler {
  /**
   * Called when a tool call starts. For client-type tools, return a string
   * to pass it as the result to onComplete handlers. If no value is returned,
   * the result will be null.
   */
  onStart?: (payload: ToolCallStartedPayload) => Promise<string | void>;
  onFail?: (payload: ToolCallFailedPayload) => Promise<void>;
  onComplete?: (payload: ToolCallCompletedPayload) => Promise<void>;
}
