import { InternalEvent, SignalMessage, SignalMessageAction } from '.';
import { TalkMessageStreamState } from './TalkMessageStreamState';
import { TalkMessageStreamPayload } from './signalling/TalkMessageStreamPayload';
import { TalkStreamInterruptedSignalMessage } from './signalling/TalkStreamInterruptedSignalMessage';
import { InternalEventEmitter } from '../modules/InternalEventEmitter';
import { SignallingClient } from '../modules/SignallingClient';

export class TalkMessageStream {
  private internalEventEmitter: InternalEventEmitter;
  private state = TalkMessageStreamState.UNSTARTED;
  private correlationId: string;
  private signallingClient: SignallingClient;

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
      signalMessage.actionType === SignalMessageAction.TALK_STREAM_INTERRUPTED
    ) {
      const message =
        signalMessage.payload as TalkStreamInterruptedSignalMessage;
      if (message.correlationId === this.correlationId) {
        this.state = TalkMessageStreamState.INTERRUPTED;
        this.onDeactivate();
      }
    }
  }

  public async endMessage(): Promise<void> {
    if (this.state === TalkMessageStreamState.ENDED) {
      console.warn(
        'Talk stream is already ended via end of speech. No need to call endMessage.',
      );
      return;
    }

    if (this.state !== TalkMessageStreamState.STREAMING) {
      console.warn('Talk stream is not active state: ' + this.state);
      return;
    }

    const payload: TalkMessageStreamPayload = {
      content: '',
      startOfSpeech: false,
      endOfSpeech: true,
      correlationId: this.correlationId,
    };
    await this.signallingClient.sendTalkMessage(payload);
    this.state = TalkMessageStreamState.ENDED;
    this.onDeactivate();
  }

  public async streamMessageChunk(
    partialMessage: string,
    endOfSpeech: boolean,
  ): Promise<void> {
    if (
      this.state !== TalkMessageStreamState.STREAMING &&
      this.state !== TalkMessageStreamState.UNSTARTED
    ) {
      // throw error
      throw new Error('Talk stream is not in an active state: ' + this.state);
    }
    const payload: TalkMessageStreamPayload = {
      content: partialMessage,
      startOfSpeech: this.state === TalkMessageStreamState.UNSTARTED,
      endOfSpeech: endOfSpeech,
      correlationId: this.correlationId,
    };
    this.state = endOfSpeech
      ? TalkMessageStreamState.ENDED
      : TalkMessageStreamState.STREAMING;
    if (this.state === TalkMessageStreamState.ENDED) {
      this.onDeactivate();
    }

    // send message to signalling client
    await this.signallingClient.sendTalkMessage(payload);
  }

  public getCorrelationId(): string {
    return this.correlationId;
  }

  public isActive(): boolean {
    return (
      this.state === TalkMessageStreamState.STREAMING ||
      this.state === TalkMessageStreamState.UNSTARTED
    );
  }

  public getState(): TalkMessageStreamState {
    return this.state;
  }
}
