import {
  Message,
  WebRtcTextMessageEvent,
  MessageRole,
  MessageStreamEvent,
} from '../types';
export class MessageHistoryClient {
  private messages: Message[] = [];

  private onMessageHistoryUpdated: ((messages: Message[]) => void) | undefined;

  private onMessageStreamEvent:
    | ((messageEvent: MessageStreamEvent) => void)
    | undefined;

  constructor(onMessageHistoryUpdated?: (messages: Message[]) => void) {
    this.onMessageHistoryUpdated = onMessageHistoryUpdated;
  }

  private webRtcTextMessageEventToMessageStreamEvent(
    event: WebRtcTextMessageEvent,
  ): MessageStreamEvent {
    return {
      id: `${event.role}::${event.message_id}`, // id is the same for persona and user for a single question response, so we need to differentiate them
      content: event.content,
      role: event.role as MessageRole,
      endOfSpeech: event.end_of_speech,
      interrupted: event.interrupted,
    };
  }

  private processUserMessage(message: MessageStreamEvent): void {
    // each user message is added directly to the history
    // user messages can not be interrupted
    const userMessage: Message = {
      id: message.id,
      content: message.content,
      role: message.role,
    };
    this.messages.push(userMessage);
  }

  private processPersonaMessage(message: Message): void {
    const personaMessage: Message = {
      id: message.id,
      content: message.content,
      role: message.role,
      interrupted: message.interrupted,
    };
    // check for existing message in the history
    const existingMessageIndex = this.messages.findIndex(
      (m) => m.id === personaMessage.id,
    );
    if (existingMessageIndex !== -1) {
      const existingMessage = this.messages[existingMessageIndex];
      // update the existing message
      this.messages[existingMessageIndex] = {
        ...existingMessage,
        content: existingMessage.content + personaMessage.content,
        interrupted: existingMessage.interrupted || personaMessage.interrupted,
      };
    } else {
      // add the new persona message to the history
      this.messages.push(message);
    }
  }

  public processWebRtcTextMessageEvent(event: WebRtcTextMessageEvent): void {
    const messageStreamEvent: MessageStreamEvent =
      this.webRtcTextMessageEventToMessageStreamEvent(event);
    // pass to callback stream
    if (this.onMessageStreamEvent) {
      this.onMessageStreamEvent(messageStreamEvent);
    }
    // update the message history
    switch (messageStreamEvent.role) {
      case MessageRole.USER:
        this.processUserMessage(messageStreamEvent);
        break;
      case MessageRole.PERSONA:
        this.processPersonaMessage(messageStreamEvent);
        break;
    }
    if (messageStreamEvent.endOfSpeech && this.onMessageHistoryUpdated) {
      this.onMessageHistoryUpdated(this.messages);
    }
  }

  public setOnMessageHistoryUpdated(
    onMessageHistoryUpdated: (messages: Message[]) => void,
  ): void {
    this.onMessageHistoryUpdated = onMessageHistoryUpdated;
  }

  public setOnMessageStreamEvent(
    onMessageStreamEvent: (messageEvent: MessageStreamEvent) => void,
  ): void {
    this.onMessageStreamEvent = onMessageStreamEvent;
  }
}
