export interface WebRtcToolCallEventBase {
  event_uid: string; // Unique ID for this event
  session_id: string; // Session ID
  tool_call_id: string; //	Unique ID for this tool call event (from the LLM)
  tool_name: string; // The tool name (e.g., "redirect")
  tool_type: string; // The tool type (e.g., "client" or "server")
  tool_subtype?: string; // The tool subtype (e.g. "webhook" or "rag") for server tools
  arguments: Record<string, any>; // LLM-generated parameters for this tool call
  timestamp: string; // ISO timestamp when event was created
  timestamp_user_action: string; // ISO timestamp of user action that triggered this
  user_action_correlation_id: string; // Correlation ID for tracking
  used_outside_engine: boolean; // Always true for tool call events
}

export interface WebRtcToolCallStartedEvent extends WebRtcToolCallEventBase {}
export interface WebRtcToolCallCompletedEvent extends WebRtcToolCallEventBase {
  result: any;
}
export interface WebRtcToolCallFailedEvent extends WebRtcToolCallEventBase {
  error_message: string;
}
