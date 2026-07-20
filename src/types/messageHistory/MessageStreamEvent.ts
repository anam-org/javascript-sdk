import { MessageRole } from './MessageRole';

export interface MessageStreamEvent {
  id: string;
  content: string;
  role: MessageRole;
  endOfSpeech: boolean;
  interrupted: boolean;
  // Zero-based index of this chunk within the turn. Optional here for backwards compatibility.
  contentIndex?: number;
  // Turn correlation id, matching the id used when driving talk streams.
  correlationId?: string;
  // Director-note cue applied to this event's content. Undefined when no cue applies.
  cueTag?: string;
}
