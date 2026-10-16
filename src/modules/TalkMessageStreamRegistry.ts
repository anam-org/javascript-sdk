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
  private streams = new Map<string, StreamRef>();

  constructor(internalEventEmitter: InternalEventEmitter) {
    internalEventEmitter.addListener(
      InternalEvent.SIGNAL_MESSAGE_RECEIVED,
      (signalMessage) => this.onSignalMessage(signalMessage),
    );
    internalEventEmitter.addListener(
      InternalEvent.TALK_STREAM_DELIVERY_FAILED,
      (correlationId) => this.take(correlationId)?.markDeliveryFailed(),
    );
  }

  public register(stream: TalkMessageStream): void {
    this.prune();
    this.streams.set(stream.getCorrelationId(), refTo(stream));
  }

  private onSignalMessage(signalMessage: SignalMessage) {
    if (
      signalMessage.actionType === SignalMessageAction.TALK_STREAM_INTERRUPTED
    ) {
      const { correlationId } =
        signalMessage.payload as TalkStreamInterruptedSignalMessage;
      this.take(correlationId)?.markInterrupted();
    }
  }

  // Both outcomes are terminal, so the stream needs no further routing.
  private take(correlationId: string): TalkMessageStream | undefined {
    const stream = this.streams.get(correlationId)?.deref();
    this.streams.delete(correlationId);
    return stream;
  }

  private prune() {
    this.streams.forEach((ref, correlationId) => {
      if (!ref.deref()) {
        this.streams.delete(correlationId);
      }
    });
  }
}
