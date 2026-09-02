import {
  Message,
  MessageUtterance,
  WebRtcTextMessageEvent,
  MessageRole,
  MessageStreamEvent,
  InternalEvent,
  AnamEvent,
} from '../types';
import { PublicEventEmitter, InternalEventEmitter } from '.';
export class MessageHistoryClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;

  private messages: Message[] = [];
  private publishedUtterances = new WeakSet<MessageUtterance[]>();

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
    const correlationId =
      event.user_action_correlation_id ?? event.correlationId;
    return {
      id: `${event.role}::${event.message_id}`, // id is the same for persona and user for a single question response, so we need to differentiate them
      content: event.content,
      role: event.role as MessageRole,
      endOfSpeech: event.end_of_speech,
      interrupted: event.interrupted,
      contentIndex: event.content_index,
      ...(event.utterance_id ? { utteranceId: event.utterance_id } : {}),
      ...(correlationId ? { correlationId } : {}),
      ...(event.cue_tag ? { cueTag: event.cue_tag } : {}),
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

  // Appends a chunk to the message's per-utterance breakdown. A joining space is prepended
  // to each subsequent utterance so the turn-level content concatenates correctly; remove
  // only that separator while preserving all other leading whitespace.
  private appendUtterance(
    utterances: MessageUtterance[] | undefined,
    messageEvent: MessageStreamEvent,
  ): MessageUtterance[] | undefined {
    if (!messageEvent.utteranceId) return utterances;
    const wasPublished =
      !!utterances && this.publishedUtterances.has(utterances);
    const current = wasPublished ? [...utterances] : utterances ?? [];
    const last = current[current.length - 1];
    if (last && last.id === messageEvent.utteranceId) {
      const updatedLast = wasPublished ? { ...last } : last;
      updatedLast.content += messageEvent.content;
      current[current.length - 1] = updatedLast;
      return current;
    }
    const content =
      current.length > 0 && messageEvent.content.startsWith(' ')
        ? messageEvent.content.slice(1)
        : messageEvent.content;
    current.push({ id: messageEvent.utteranceId, content });
    return current;
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
      const utterances = this.appendUtterance(
        existingMessage.utterances,
        messageEvent,
      );
      // update the existing message
      this.messages[existingMessageIndex] = {
        ...existingMessage,
        content: existingMessage.content + personaMessage.content,
        interrupted: existingMessage.interrupted || personaMessage.interrupted,
        ...(utterances ? { utterances } : {}),
      };
    } else {
      const utterances = this.appendUtterance(undefined, messageEvent);
      // add the new persona message to the history
      this.messages.push({
        ...personaMessage,
        ...(utterances ? { utterances } : {}),
      });
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
      this.messages.forEach((message) => {
        if (message.utterances) {
          this.publishedUtterances.add(message.utterances);
        }
      });
      this.publicEventEmitter.emit(
        AnamEvent.MESSAGE_HISTORY_UPDATED,
        this.messages,
      );
    }
  }
}
