export interface WebRtcTextMessageEvent {
  message_id: string;
  content_index: number;
  content: string;
  role: string;
  end_of_speech: boolean;
  interrupted: boolean;
  // Director-note cue applied to this chunk's content. Empty or absent when no cue applies;
  // only sent by engines with director-note cues enabled.
  cue_tag?: string;
  // Turn correlation id. Engines emit it as `user_action_correlation_id`; some payloads use the
  // `correlationId` alias. Absent on older engines.
  user_action_correlation_id?: string;
  correlationId?: string;
}
