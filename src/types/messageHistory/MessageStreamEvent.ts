import { MessageRole } from './MessageRole';

export interface MessageStreamEvent {
  id: string;
  content: string;
  role: MessageRole;
  endOfSpeech: boolean;
  interrupted: boolean;
}
