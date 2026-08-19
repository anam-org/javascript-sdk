export interface TalkMessageStreamPayload {
  content: string;
  startOfSpeech: boolean;
  endOfSpeech: boolean;
  correlationId: string;
  // Optional client-scoped utterance key. Chunks sharing a key form one utterance;
  // changing it starts a new one. Omitted means "same utterance as before".
  // A canonical UUIDv4 is echoed back as MessageStreamEvent.utteranceId.
  utteranceId?: string;
}
