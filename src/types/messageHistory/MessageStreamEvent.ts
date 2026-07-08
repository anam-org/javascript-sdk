import { MessageRole } from './MessageRole';

export interface MessageStreamEvent {
  id: string;
  content: string;
  role: MessageRole;
  endOfSpeech: boolean;
  interrupted: boolean;
  // Director-note cue applied to this event's content. Undefined when no cue applies.
  cueTag?: string;
}
