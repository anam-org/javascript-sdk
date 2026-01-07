export interface WebRtcReasoningTextMessageEvent {
  message_id: string;
  content_index: number;
  content: string;
  role: string;
  end_of_thought: boolean;
}
