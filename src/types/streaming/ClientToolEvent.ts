export interface ClientToolEvent {
  // Core event fields
  eventUid: string; // Unique ID for this event
  sessionId: string; // Session ID
  eventName: string; // The tool name (e.g., "redirect")
  eventData: Record<string, any>; // LLM-generated parameters

  // Timing & correlation
  timestamp: string; // ISO timestamp when event was created
  timestampUserAction: string; // ISO timestamp of user action that triggered this
  userActionCorrelationId: string; // Correlation ID for tracking
}
