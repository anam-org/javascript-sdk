import { SignalMessage } from '../types';
import { TalkMessageStreamPayload } from '../types/signalling/TalkMessageStreamPayload';

export const TALK_STREAM_ACK_TIMEOUT_MS = 3000;
// Under the engine's 15s talk-stream turn timeout (talk_stream_timeout_secs in
// anam-engine), so a replay still lands in an open turn.
export const TALK_STREAM_MAX_HOLD_MS = 10000;

export interface TalkStreamDeliveryCallbacks {
  // A chunk sent on the current socket went unacked: the socket is presumed half-open.
  onAckTimeout: () => void;
  // A correlationId's chunks were held too long and have been dropped.
  onDeliveryFailed: (correlationId: string) => void;
}

interface TrackedMessage {
  message: SignalMessage;
  correlationId: string;
  sequence: number;
  queuedAt: number;
  // When the message was last written to a socket; null while it waits for one.
  sentAt: number | null;
}

const holdDeadline = (entry: TrackedMessage): number =>
  entry.queuedAt + TALK_STREAM_MAX_HOLD_MS;

// Entries waiting for a socket have no ack deadline.
const ackDeadline = (entry: TrackedMessage): number =>
  entry.sentAt === null ? Infinity : entry.sentAt + TALK_STREAM_ACK_TIMEOUT_MS;

/**
 * Holds talk-stream messages until the engine acknowledges them, so they can be
 * replayed after the signalling socket is replaced. A half-open socket accepts
 * writes without error, so a send alone does not mean the engine received anything.
 */
export class TalkStreamDeliveryTracker {
  private enabled = false;
  private queue: TrackedMessage[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: TalkStreamDeliveryCallbacks;

  constructor(callbacks: TalkStreamDeliveryCallbacks) {
    this.callbacks = callbacks;
  }

  public enable(): void {
    this.enabled = true;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public track(message: SignalMessage, sentNow: boolean): void {
    const payload = message.payload as TalkMessageStreamPayload;
    const now = Date.now();
    this.queue.push({
      message,
      correlationId: payload.correlationId,
      sequence: payload.sequence,
      queuedAt: now,
      sentAt: sentNow ? now : null,
    });
    this.schedule();
  }

  public markAllSent(): void {
    const now = Date.now();
    this.queue.forEach((entry) => {
      entry.sentAt = now;
    });
    this.schedule();
  }

  public ack(correlationId: string, sequence: number): void {
    this.queue = this.queue.filter(
      (entry) =>
        entry.correlationId !== correlationId || entry.sequence > sequence,
    );
    this.schedule();
  }

  public pending(): SignalMessage[] {
    return this.queue.map((entry) => entry.message);
  }

  public failAll(): void {
    const correlationIds = this.correlationIds(this.queue);
    this.clear();
    correlationIds.forEach((id) => this.callbacks.onDeliveryFailed(id));
  }

  public clear(): void {
    this.queue = [];
    this.clearTimer();
  }

  private schedule(): void {
    this.clearTimer();
    if (this.queue.length === 0) {
      return;
    }
    const deadlines = this.queue.map((entry) =>
      Math.min(holdDeadline(entry), ackDeadline(entry)),
    );
    const delay = Math.max(0, Math.min(...deadlines) - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onDeadline();
    }, delay);
  }

  private onDeadline(): void {
    const now = Date.now();
    const expiredIds = this.correlationIds(
      this.queue.filter((entry) => now >= holdDeadline(entry)),
    );
    this.queue = this.queue.filter(
      (entry) => !expiredIds.includes(entry.correlationId),
    );
    const ackTimedOut = this.queue.some((entry) => now >= ackDeadline(entry));
    if (ackTimedOut) {
      // The socket these were written to is presumed dead; they wait for a replay.
      this.queue.forEach((entry) => {
        entry.sentAt = null;
      });
    }
    this.schedule();
    expiredIds.forEach((id) => this.callbacks.onDeliveryFailed(id));
    if (ackTimedOut) {
      this.callbacks.onAckTimeout();
    }
  }

  private correlationIds(entries: TrackedMessage[]): string[] {
    return [...new Set(entries.map((entry) => entry.correlationId))];
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
