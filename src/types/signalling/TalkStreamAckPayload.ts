// Cumulative: every chunk of correlationId up to and including sequence reached the engine.
export interface TalkStreamAckPayload {
  correlationId: string;
  sequence: number;
}
