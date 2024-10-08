export interface TalkMessageStreamPayload {
  content: string;
  startOfSpeech: boolean;
  endOfSpeech: boolean;
  correlationId: string;
}
