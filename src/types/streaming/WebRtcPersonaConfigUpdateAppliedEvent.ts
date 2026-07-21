export interface WebRtcPersonaConfigUpdateAppliedEvent {
  session_id: string;
  // Changed config path -> { before, after } values.
  changed_fields: Record<string, { before?: unknown; after?: unknown }>;
}
