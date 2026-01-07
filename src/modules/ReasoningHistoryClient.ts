import { PublicEventEmitter, InternalEventEmitter } from '.';
import {
  AnamEvent,
  InternalEvent,
  ReasoningMessage,
  ReasoningStreamEvent,
  WebRtcReasoningTextMessageEvent,
} from '../types';

export class ReasoningHistoryClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;

  private reasoning_messages: ReasoningMessage[] = [];
  constructor(
    publicEventEmitter: PublicEventEmitter,
    internalEventEmitter: InternalEventEmitter,
  ) {
    this.publicEventEmitter = publicEventEmitter;
    this.internalEventEmitter = internalEventEmitter;
    // register for events
    this.internalEventEmitter.addListener(
      InternalEvent.WEBRTC_REASONING_TEXT_MESSAGE_RECEIVED,
      this.processWebRtcReasoningTextMessageEvent.bind(this),
    );
  }

  private webRtcTextMessageEventToReasoningStreamEvent(
    event: WebRtcReasoningTextMessageEvent,
  ): ReasoningStreamEvent {
    return {
      id: `${event.role}::${event.message_id}`,
      content: event.content,
      endOfThought: event.end_of_thought,
      role: event.role,
    };
  }

  private processWebRtcReasoningTextMessageEvent(
    event: WebRtcReasoningTextMessageEvent,
  ): void {
    const ReasoningStreamEvent: ReasoningStreamEvent =
      this.webRtcTextMessageEventToReasoningStreamEvent(event);

    this.publicEventEmitter.emit(
      AnamEvent.REASONING_STREAM_EVENT_RECEIVED,
      ReasoningStreamEvent,
    );

    const message: ReasoningMessage = {
      id: ReasoningStreamEvent.id,
      content: ReasoningStreamEvent.content,
      role: ReasoningStreamEvent.role,
    };

    const existingMessageIndex = this.reasoning_messages.findIndex(
      (m) => m.id === message.id,
    );
    if (existingMessageIndex !== -1) {
      // update existing message
      const existingMessage = this.reasoning_messages[existingMessageIndex];
      existingMessage.content += message.content;
      this.reasoning_messages[existingMessageIndex] = existingMessage;
    } else {
      // new message
      this.reasoning_messages.push(message);
    }

    if (ReasoningStreamEvent.endOfThought) {
      this.publicEventEmitter.emit(
        AnamEvent.REASONING_HISTORY_UPDATED,
        this.reasoning_messages,
      );
    }
  }
}
