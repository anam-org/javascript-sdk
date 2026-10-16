import { TalkMessageStreamPayload } from '../types/signalling/TalkMessageStreamPayload';

export const TALK_STREAM_ACK_TIMEOUT_MS = 3000;

export interface TalkStreamDeliveryCallbacks {
  // Chunks on the current socket went unacked and have been failed: the socket
  // is presumed half-open.
  onAckTimeout: () => void;
  // A correlationId's chunks could not be confirmed.
  onDeliveryFailed: (correlationId: string) => void;
}

interface UnackedChunk {
  correlationId: string;
  sequence: number;
  sentAt: number;
}

/**
 * Tracks talk-stream chunks written to the signalling socket until the engine
 * acknowledges them. A half-open socket accepts writes without error, so a send
 * alone does not mean the engine received anything. Chunks are never resent: an
 * unacked chunk fails its stream, and the caller decides what to do next.
 */
export class TalkStreamDeliveryTracker {
  // In send order, so the first entry has the earliest ack deadline.
  private unacked: UnackedChunk[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: TalkStreamDeliveryCallbacks;

  constructor(callbacks: TalkStreamDeliveryCallbacks) {
    this.callbacks = callbacks;
  }

  public track(payload: TalkMessageStreamPayload): void {
    this.unacked.push({
      correlationId: payload.correlationId,
      sequence: payload.sequence,
      sentAt: Date.now(),
    });
    this.schedule();
  }

  public ack(correlationId: string, sequence: number): void {
    this.unacked = this.unacked.filter(
      (entry) =>
        entry.correlationId !== correlationId || entry.sequence > sequence,
    );
    this.schedule();
  }

  // Forget a correlationId's chunks without reporting a failure.
  public drop(correlationId: string): void {
    this.unacked = this.unacked.filter(
      (entry) => entry.correlationId !== correlationId,
    );
    this.schedule();
  }

  // The socket the chunks were written to is gone, so their acks will not arrive.
  public failAll(): void {
    const correlationIds = [
      ...new Set(this.unacked.map((entry) => entry.correlationId)),
    ];
    this.clear();
    correlationIds.forEach((id) => this.callbacks.onDeliveryFailed(id));
  }

  public clear(): void {
    this.unacked = [];
    this.clearTimer();
  }

  private schedule(): void {
    this.clearTimer();
    if (this.unacked.length === 0) {
      return;
    }
    const deadline = this.unacked[0].sentAt + TALK_STREAM_ACK_TIMEOUT_MS;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        // Every unacked chunk was written to the socket presumed dead.
        this.failAll();
        this.callbacks.onAckTimeout();
      },
      Math.max(0, deadline - Date.now()),
    );
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
