export interface WebRtcTextMessageEvent {
  message_id: string;
  content_index: number;
  content: string;
  role: string;
  end_of_speech: boolean;
  interrupted: boolean;
  // Director-note cue applied to this chunk's content. Empty or absent when no cue applies;
  cue_tag?: string;
  // Turn correlation id. Emitted as `user_action_correlation_id`
  user_action_correlation_id?: string;
  // Alias for `user_action_correlation_id`
  correlationId?: string;
}
