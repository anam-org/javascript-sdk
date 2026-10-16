/// <reference lib="es2021.weakref" />
import { InternalEvent, SignalMessage, SignalMessageAction } from '../types';
import { TalkMessageStream } from '../types/TalkMessageStream';
import { TalkStreamInterruptedSignalMessage } from '../types/signalling/TalkStreamInterruptedSignalMessage';
import { InternalEventEmitter } from './InternalEventEmitter';

interface StreamRef {
  deref(): TalkMessageStream | undefined;
}

// Weak where the runtime supports it: once the caller drops a stream, nothing can
// observe its state, so it can be collected. Older runtimes hold it strongly.
const refTo = (stream: TalkMessageStream): StreamRef =>
  typeof WeakRef === 'function' ? new WeakRef(stream) : { deref: () => stream };

/**
 * Routes interruptions and delivery failures to the talk stream they belong to.
 * A stream can be interrupted long after it ends, while it plays, and no signal
 * says when playback is over, so streams cannot unsubscribe themselves. One
 * listener here replaces a listener per stream that lived for the whole session.
 */
export class TalkMessageStreamRegistry {
  // A caller can reuse a correlationId; every stream with it gets the outcome, as
  // when each stream listened for itself.
  private streams = new Map<string, StreamRef[]>();
  private internalEventEmitter: InternalEventEmitter;

  constructor(internalEventEmitter: InternalEventEmitter) {
    this.internalEventEmitter = internalEventEmitter;
    internalEventEmitter.addListener(
      InternalEvent.SIGNAL_MESSAGE_RECEIVED,
      this.onSignalMessage,
    );
    internalEventEmitter.addListener(
      InternalEvent.TALK_STREAM_DELIVERY_FAILED,
      this.onDeliveryFailed,
    );
  }

  // The emitter belongs to the client and outlives the session, so the registry
  // must unsubscribe when its session ends.
  public dispose(): void {
    this.internalEventEmitter.removeListener(
      InternalEvent.SIGNAL_MESSAGE_RECEIVED,
      this.onSignalMessage,
    );
    this.internalEventEmitter.removeListener(
      InternalEvent.TALK_STREAM_DELIVERY_FAILED,
      this.onDeliveryFailed,
    );
    this.streams.clear();
  }

  public register(stream: TalkMessageStream): void {
    this.prune();
    const correlationId = stream.getCorrelationId();
    this.streams.set(correlationId, [
      ...(this.streams.get(correlationId) ?? []),
      refTo(stream),
    ]);
  }

  private onSignalMessage = (signalMessage: SignalMessage) => {
    if (
      signalMessage.actionType === SignalMessageAction.TALK_STREAM_INTERRUPTED
    ) {
      const { correlationId } =
        signalMessage.payload as TalkStreamInterruptedSignalMessage;
      this.take(correlationId).forEach((stream) => stream.markInterrupted());
    }
  };

  private onDeliveryFailed = (correlationId: string) => {
    this.take(correlationId).forEach((stream) => stream.markDeliveryFailed());
  };

  // Both outcomes are terminal, so the stream needs no further routing.
  private take(correlationId: string): TalkMessageStream[] {
    const streams = (this.streams.get(correlationId) ?? [])
      .map((ref) => ref.deref())
      .filter((stream): stream is TalkMessageStream => stream !== undefined);
    this.streams.delete(correlationId);
    return streams;
  }

  private prune() {
    this.streams.forEach((refs, correlationId) => {
      const live = refs.filter((ref) => ref.deref());
      if (live.length === 0) {
        this.streams.delete(correlationId);
      } else {
        this.streams.set(correlationId, live);
      }
    });
  }
}
