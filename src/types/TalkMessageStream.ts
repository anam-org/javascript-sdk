import { InternalEvent, SignalMessage, SignalMessageAction } from '.';
import { TalkMessageStreamState } from './TalkMessageStreamState';
import { TalkMessageStreamPayload } from './signalling/TalkMessageStreamPayload';
import { TalkStreamInterruptedSignalMessage } from './signalling/TalkStreamInterruptedSignalMessage';
import { InternalEventEmitter } from '../modules/InternalEventEmitter';
import { SignallingClient } from '../modules/SignallingClient';

// Lowercase only: the engine round-trips the canonical form and replaces anything
// else with an id of its own, so an uppercase id would never reach caption events.
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * A stream of text chunks for the persona to speak.
 *
 * Manages the correlationId internally so callers don't need to track it across chunks.
 * All chunks in the same speech sequence share one correlationId, which is what
 * interruptions correlate against. Callers can optionally identify utterances within the
 * sequence by passing an utteranceId to streamMessageChunk. Set an id on the first chunk
 * of an utterance, then omit it on continuation chunks. A new id queues the next
 * utterance after the current one, so the stream can stay open while your application
 * runs a tool.
 *
 * @example
 * ```typescript
 * // Streaming LLM output
 * const stream = anamClient.createTalkMessageStream();
 * for (const chunk of llmChunks) {
 *   await stream.streamMessageChunk(chunk.text, chunk.isLast);
 * }
 *
 * // Speech before and after a tool call
 * const stream = anamClient.createTalkMessageStream();
 * await stream.streamMessageChunk('Let me ', false, crypto.randomUUID());
 * await stream.streamMessageChunk('check.', false); // Continues the same utterance.
 * const toolResultText = await runToolCall();
 * await stream.streamMessageChunk(toolResultText, true, crypto.randomUUID());
 * ```
 */
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
   * @param utteranceId Optional lowercase UUID v4 string marking the utterance this chunk
   * starts. Set it on the first chunk, not on every text chunk; omitting it continues the
   * current utterance. A new id queues the next utterance after the current one without
   * ending the speech sequence, which is what allows speech before and after a tool call,
   * or two ready utterances that must play in order. The most recent value is reused for
   * the terminator sent by endMessage. Throws if it is not a lowercase UUID v4. Needs a
   * Cara 4 avatar: Cara 3 avatars drop the id silently and speak the turn as one
   * utterance.
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
        'utteranceId must be a lowercase UUID v4 string, got: ' + utteranceId,
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
