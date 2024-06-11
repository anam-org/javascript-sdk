export interface TextMessageEvent {
  message_id: string;
  content_index: number;
  content: string;
  message_type: string;
  end_of_speech: boolean;
}
