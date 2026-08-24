import { InternalEvent, SignalMessage, SignalMessageAction } from '.';
import { TalkMessageStreamState } from './TalkMessageStreamState';
import { TalkMessageStreamPayload } from './signalling/TalkMessageStreamPayload';
import { TalkStreamInterruptedSignalMessage } from './signalling/TalkStreamInterruptedSignalMessage';
import { InternalEventEmitter } from '../modules/InternalEventEmitter';
import { SignallingClient } from '../modules/SignallingClient';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TalkMessageStream {
  private internalEventEmitter: InternalEventEmitter;
  private state = TalkMessageStreamState.UNSTARTED;
  private correlationId: string;
  private signallingClient: SignallingClient;
  private lastUtteranceId?: string;

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

  /**
   * End the stream without sending more content.
   *
   * The terminator carries the most recent utteranceId passed to
   * streamMessageChunk, so it does not start a new untagged utterance.
   */
  public async endMessage(): Promise<void> {
    if (this.state === TalkMessageStreamState.ENDED) {
      console.warn(
        'Talk stream is already ended via end of speech. No need to call endMessage.',
      );
      return;
    }

    if (this.state !== TalkMessageStreamState.STREAMING) {
      console.warn('Talk stream is not in an active state: ' + this.state);
      return;
    }

    const payload: TalkMessageStreamPayload = {
      content: '',
      startOfSpeech: false,
      endOfSpeech: true,
      correlationId: this.correlationId,
      ...(this.lastUtteranceId != null
        ? { utteranceId: this.lastUtteranceId }
        : {}),
    };
    await this.signallingClient.sendTalkMessage(payload);
    this.state = TalkMessageStreamState.ENDED;
    this.onDeactivate();
  }

  /**
   * Send a text chunk to be spoken.
   *
   * @param partialMessage The text chunk to speak.
   * @param endOfSpeech Whether this is the final chunk of the speech.
   * @param utteranceId Optional UUID v4 string identifying the utterance this chunk
   * belongs to. Reuse the same id for consecutive chunks in one utterance; changing it
   * starts a new utterance without ending the speech sequence. The most recent value is
   * reused for the terminator sent by endMessage. Throws if it is not a UUID v4.
   */
  public async streamMessageChunk(
    partialMessage: string,
    endOfSpeech: boolean,
    utteranceId?: string,
  ): Promise<void> {
    if (
      this.state !== TalkMessageStreamState.STREAMING &&
      this.state !== TalkMessageStreamState.UNSTARTED
    ) {
      // throw error
      throw new Error('Talk stream is not in an active state: ' + this.state);
    }
    if (utteranceId != null && !UUID_V4.test(utteranceId)) {
      throw new Error(
        'utteranceId must be a UUID v4 string, got: ' + utteranceId,
      );
    }
    const payload: TalkMessageStreamPayload = {
      content: partialMessage,
      startOfSpeech: this.state === TalkMessageStreamState.UNSTARTED,
      endOfSpeech: endOfSpeech,
      correlationId: this.correlationId,
      ...(utteranceId != null ? { utteranceId } : {}),
    };
    if (utteranceId != null) {
      this.lastUtteranceId = utteranceId;
    }
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
