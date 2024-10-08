import {
  AnamEvent,
  InternalEvent,
  SignalMessage,
  SignalMessageAction,
} from './types';
import { ChatStreamState } from './types/ChatMessageStreamState';
import { ChatMessageStreamPayload } from './types/signalling/ChatMessageStreamPayload';
import { ChatStreamInterruptedSignalMessage } from './types/signalling/ChatStreamInterruptedSignalMessage';
import { InternalEventEmitter } from './modules/InternalEventEmitter';
import { SignallingClient } from './modules/SignallingClient';

export class ChatMessageStream {
  private internalEventEmitter: InternalEventEmitter;
  private state = ChatStreamState.UNSTARTED;
  private correlationId: string;
  private signallingClient: any; // Define the type as needed

  constructor(
    correlationId: string,
    internalEventEmitter: InternalEventEmitter,
    signallingClient: SignallingClient,
  ) {
    this.correlationId = correlationId;
    this.internalEventEmitter = internalEventEmitter;
    this.signallingClient = signallingClient;

    this.internalEventEmitter.addListener(
      InternalEvent.SIGNAL_MESSAGE_RECEIVED,
      this.onSignalMessage.bind(this),
    );
  }

  private onDeactivate() {
    this.internalEventEmitter.removeListener(
      InternalEvent.SIGNAL_MESSAGE_RECEIVED,
      this.onSignalMessage.bind(this),
    );
  }

  private async onSignalMessage(signalMessage: SignalMessage) {
    if (
      signalMessage.actionType === SignalMessageAction.CHAT_STREAM_INTERRUPTED
    ) {
      const message =
        signalMessage.payload as ChatStreamInterruptedSignalMessage;
      if (message.correlationId === this.correlationId) {
        this.state = ChatStreamState.INTERRUPTED;
        this.onDeactivate();
      }
    }
  }

  public async endMessage(): Promise<void> {
    if (this.state === ChatStreamState.ENDED) {
      console.warn(
        'Chat stream is already ended via end of speech. No need to call endMessage.',
      );
      return;
    }

    if (this.state !== ChatStreamState.STREAMING) {
      console.warn('Chat stream is not active state: ' + this.state);
      return;
    }

    const payload: ChatMessageStreamPayload = {
      content: '',
      startOfSpeech: false,
      endOfSpeech: true,
      correlationId: this.correlationId,
    };
    await this.signallingClient.sendChatMessage(payload);
    this.state = ChatStreamState.ENDED;
    this.onDeactivate();
  }

  public async streamPartialMessage(
    partialMessage: string,
    endOfSpeech: boolean,
  ): Promise<void> {
    if (
      this.state !== ChatStreamState.STREAMING &&
      this.state !== ChatStreamState.UNSTARTED
    ) {
      // throw error
      throw new Error('Chat stream is not in an active state: ' + this.state);
    }
    const payload: ChatMessageStreamPayload = {
      content: partialMessage,
      startOfSpeech: this.state === ChatStreamState.UNSTARTED,
      endOfSpeech: endOfSpeech,
      correlationId: this.correlationId,
    };
    this.state = endOfSpeech
      ? ChatStreamState.ENDED
      : ChatStreamState.STREAMING;
    if (this.state === ChatStreamState.ENDED) {
      this.onDeactivate();
    }

    // send message to signalling client
    await this.signallingClient.sendChatMessage(payload);
  }

  public getCorrelationId(): string {
    return this.correlationId;
  }

  public isActive(): boolean {
    return (
      this.state === ChatStreamState.STREAMING ||
      this.state === ChatStreamState.UNSTARTED
    );
  }

  public getState(): ChatStreamState {
    return this.state;
  }
}
