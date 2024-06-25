export interface WebRtcTextMessageEvent {
  message_id: string;
  content_index: number;
  content: string;
  role: string;
  end_of_speech: boolean;
  interrupted: boolean;
}
