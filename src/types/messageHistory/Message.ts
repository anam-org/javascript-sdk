import { MessageRole } from './MessageRole';

export interface MessageUtterance {
  // Id of the persona utterance, matching MessageStreamEvent.utteranceId.
  id: string;
  content: string;
}

export interface Message {
  id: string;
  content: string;
  role: MessageRole;
  interrupted?: boolean;
  // Per-utterance breakdown of content, in speaking order. Only present on persona
  // messages when the engine sends utterance ids; older engines omit it.
  utterances?: MessageUtterance[];
}
