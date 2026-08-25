export interface TalkMessageStreamPayload {
  content: string;
  startOfSpeech: boolean;
  endOfSpeech: boolean;
  correlationId: string;
  // Optional lowercase UUID v4 marking the first chunk of a new utterance. Omitted
  // continues the current utterance; a different id queues a new one after it. The id
  // comes back on MessageStreamEvent.utteranceId.
  utteranceId?: string;
}
