import { Message, WebRtcTextMessageEvent, MessageRole } from '../types';
export class MessageHistoryClient {
  private messages: Message[] = [];

  private onMessageHistoryUpdated: ((messages: Message[]) => void) | undefined =
    undefined;

  constructor(onMessageHistoryUpdated?: (messages: Message[]) => void) {
    this.onMessageHistoryUpdated = onMessageHistoryUpdated;
  }

  private webRtcTextMessageEventToMessage(
    event: WebRtcTextMessageEvent,
  ): Message {
    return {
      id: `${event.message_type}::${event.message_id}`, // id is the same for persona and user for a single question response, so we need to differentiate them
      content: event.content,
      role: event.message_type as MessageRole,
    };
  }

  private processUserMessage(message: Message): void {
    // each user message is added directly to the history
    this.messages.push(message);
  }

  private processPersonaMessage(message: Message): void {
    // check for existing message in the history
    const existingMessageIndex = this.messages.findIndex(
      (m) => m.id === message.id,
    );
    if (existingMessageIndex !== -1) {
      const existingMessage = this.messages[existingMessageIndex];
      // update the existing message
      this.messages[existingMessageIndex] = {
        ...existingMessage,
        content: existingMessage.content + message.content,
      };
    } else {
      // add the new persona message to the history
      this.messages.push(message);
    }
  }

  public processWebRtcTextMessageEvent(event: WebRtcTextMessageEvent): void {
    const message: Message = this.webRtcTextMessageEventToMessage(event);
    switch (message.role) {
      case MessageRole.USER:
        this.processUserMessage(message);
        break;
      case MessageRole.PERSONA:
        this.processPersonaMessage(message);
        break;
    }
    if (event.end_of_speech && this.onMessageHistoryUpdated) {
      this.onMessageHistoryUpdated(this.messages);
    }
  }

  public setOnMessageHistoryUpdated(
    onMessageHistoryUpdated: (messages: Message[]) => void,
  ): void {
    this.onMessageHistoryUpdated = onMessageHistoryUpdated;
  }
}
