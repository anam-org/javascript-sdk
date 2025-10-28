export interface ClientToolEvent {
  // Core event fields
  event_uid: string; // Unique ID for this event
  session_id: string; // Session ID
  event_name: string; // The tool name (e.g., "redirect")
  event_data: Record<string, any>; // LLM-generated parameters

  // Timing & correlation
  timestamp: string; // ISO timestamp when event was created
  timestamp_user_action: string; // ISO timestamp of user action that triggered this
  user_action_correlation_id: string; // Correlation ID for tracking

  // Metadata
  used_outside_engine: boolean; // Always true for client events
}
