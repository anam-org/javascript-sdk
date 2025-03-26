import { MessageRole } from './MessageRole';

export interface Message {
  id: string;
  content: string;
  role: MessageRole;
  interrupted?: boolean;
}
