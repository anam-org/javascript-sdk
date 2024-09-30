export interface ChatMessageStreamPayload {
  content: string;
  startOfSpeech: boolean;
  endOfSpeech: boolean;
  frontEndCorrelationId: string;
}
