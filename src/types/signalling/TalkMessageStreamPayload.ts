export interface TalkMessageStreamPayload {
  content: string;
  startOfSpeech: boolean;
  endOfSpeech: boolean;
  correlationId: string;
  // Position of this chunk within its correlationId, starting at 0. The engine acks by it
  // and drops chunks it has already seen, so a replay after a reconnect is not spoken twice.
  sequence: number;
  // Optional lowercase UUID v4 marking the first chunk of a new utterance. Omitted
  // continues the current utterance; a different id queues a new one after it. The id
  // comes back on MessageStreamEvent.utteranceId.
  utteranceId?: string;
}
