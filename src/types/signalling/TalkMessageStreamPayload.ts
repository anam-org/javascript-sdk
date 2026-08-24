export interface TalkMessageStreamPayload {
  content: string;
  startOfSpeech: boolean;
  endOfSpeech: boolean;
  correlationId: string;
  // Optional UUID v4 identifying the utterance this chunk belongs to. Chunks sharing
  // an id form one utterance; a different id starts a new one. Omitted means "same
  // utterance as before". The id comes back on MessageStreamEvent.utteranceId.
  utteranceId?: string;
}
