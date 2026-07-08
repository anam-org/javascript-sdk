export interface WebRtcDirectorNoteCueAppliedEvent {
  session_id: string;
  user_action_correlation_id: string;
  timestamp_user_action: string;
  director_note_tag: string;
}
