import {
  Message,
  WebRtcTextMessageEvent,
  MessageRole,
  MessageStreamEvent,
  InternalEvent,
  AnamEvent,
} from '../types';
import { PublicEventEmitter, InternalEventEmitter } from '../modules';
export class MessageHistoryClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;

  private messages: Message[] = [];

  constructor(
    publicEventEmitter: PublicEventEmitter,
    internalEventEmitter: InternalEventEmitter,
  ) {
    this.publicEventEmitter = publicEventEmitter;
    this.internalEventEmitter = internalEventEmitter;
    // register for events
    this.internalEventEmitter.addListener(
      InternalEvent.WEBRTC_CHAT_MESSAGE_RECEIVED,
      this.processWebRtcTextMessageEvent.bind(this),
    );
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

  private processUserMessage(messageEvent: MessageStreamEvent): void {
    // each user message is added directly to the history
    // user messages can not be interrupted
    const userMessage: Message = {
      id: messageEvent.id,
      content: messageEvent.content,
      role: messageEvent.role,
    };
    this.messages.push(userMessage);
  }

  private processPersonaMessage(messageEvent: MessageStreamEvent): void {
    const personaMessage: Message = {
      id: messageEvent.id,
      content: messageEvent.content,
      role: messageEvent.role,
      interrupted: messageEvent.interrupted,
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
      this.messages.push(personaMessage);
    }
  }

  public processWebRtcTextMessageEvent(event: WebRtcTextMessageEvent): void {
    const messageStreamEvent: MessageStreamEvent =
      this.webRtcTextMessageEventToMessageStreamEvent(event);
    // pass to callback stream
    this.publicEventEmitter.emit(
      AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED,
      messageStreamEvent,
    );
    // update the message history
    switch (messageStreamEvent.role) {
      case MessageRole.USER:
        this.processUserMessage(messageStreamEvent);
        break;
      case MessageRole.PERSONA:
        this.processPersonaMessage(messageStreamEvent);
        break;
    }
    if (messageStreamEvent.endOfSpeech) {
      this.publicEventEmitter.emit(
        AnamEvent.MESSAGE_HISTORY_UPDATED,
        this.messages,
      );
    }
  }
}
