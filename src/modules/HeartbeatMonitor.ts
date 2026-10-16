// An unanswered heartbeat older than this means the socket is presumed dead.
export const HEARTBEAT_ACK_TIMEOUT_MS = 3000;
// An unanswered heartbeat older than this makes the socket suspect: new talk-stream
// chunks fail instead of being written into it. A healthy answer takes well under 1s.
export const HEARTBEAT_SUSPECT_MS = 1500;
// Chunks written within this window share one confirming heartbeat.
export const HEARTBEAT_PROBE_COALESCE_MS = 100;

export interface HeartbeatMonitorCallbacks {
  // Writes a heartbeat; returns false when there is no open socket.
  sendHeartbeat: (seq: number) => boolean;
  // A heartbeat went unanswered. Chunks waiting on it have already been failed.
  onAckTimeout: (failedChunks: boolean) => void;
  // A correlationId's chunks could not be confirmed.
  onDeliveryFailed: (correlationId: string) => void;
  // Time from writing a heartbeat to receiving its answer.
  onRoundTrip?: (ms: number) => void;
}

interface PendingHeartbeat {
  seq: number;
  sentAt: number;
}

interface UnconfirmedChunk {
  correlationId: string;
  // The first heartbeat written after the chunk; its answer confirms the chunk.
  confirmedBy: number;
}

/**
 * Sends sequenced heartbeats and matches the engine's answers. The engine answers
 * from the loop that reads client messages, so the answer to heartbeat N confirms
 * that everything written before heartbeat N arrived. A half-open socket accepts
 * writes without error, so an answer is the only proof that anything got through.
 *
 * Talk-stream chunks are tracked until a heartbeat written after them is answered,
 * and a heartbeat is sent shortly after each chunk so that happens within one round
 * trip. Chunks are never resent: an unconfirmed chunk fails its stream.
 */
export class HeartbeatMonitor {
  // Never reset: an answer replayed onto a new socket must not confirm chunks
  // written to it.
  private nextSeq = 0;
  private pending: PendingHeartbeat[] = [];
  private unconfirmed: UnconfirmedChunk[] = [];
  private lastSentAt = -Infinity;
  private enabled = true;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: HeartbeatMonitorCallbacks;

  constructor(callbacks: HeartbeatMonitorCallbacks) {
    this.callbacks = callbacks;
  }

  public beat(): void {
    const seq = this.nextSeq++;
    if (!this.callbacks.sendHeartbeat(seq) || !this.enabled) {
      return;
    }
    const now = Date.now();
    this.lastSentAt = now;
    this.pending.push({ seq, sentAt: now });
    this.scheduleTimeout();
  }

  public trackChunk(correlationId: string): void {
    if (!this.enabled) {
      return;
    }
    this.unconfirmed.push({ correlationId, confirmedBy: this.nextSeq });
    this.requestProbe();
  }

  public onAck(seq: number): void {
    const answered = this.pending.find((heartbeat) => heartbeat.seq === seq);
    if (answered) {
      this.callbacks.onRoundTrip?.(Date.now() - answered.sentAt);
    }
    this.pending = this.pending.filter((heartbeat) => heartbeat.seq > seq);
    this.unconfirmed = this.unconfirmed.filter(
      (chunk) => chunk.confirmedBy > seq,
    );
    this.scheduleTimeout();
  }

  public isSuspect(): boolean {
    return (
      this.pending.length > 0 &&
      Date.now() - this.pending[0].sentAt >= HEARTBEAT_SUSPECT_MS
    );
  }

  // Forget a correlationId's chunks without reporting a failure.
  public drop(correlationId: string): void {
    this.unconfirmed = this.unconfirmed.filter(
      (chunk) => chunk.correlationId !== correlationId,
    );
  }

  // The socket is gone: its heartbeats will not be answered, so its chunks fail.
  public reset(): void {
    this.pending = [];
    this.clearTimers();
    this.failUnconfirmed();
  }

  // The engine does not answer heartbeats: stop tracking without reporting anything.
  public disable(): void {
    this.enabled = false;
    this.clear();
  }

  public clear(): void {
    this.pending = [];
    this.unconfirmed = [];
    this.clearTimers();
  }

  private requestProbe(): void {
    if (this.probeTimer) {
      return;
    }
    const delay = Math.max(
      0,
      this.lastSentAt + HEARTBEAT_PROBE_COALESCE_MS - Date.now(),
    );
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      this.beat();
    }, delay);
  }

  private scheduleTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.pending.length === 0) {
      return;
    }
    const deadline = this.pending[0].sentAt + HEARTBEAT_ACK_TIMEOUT_MS;
    this.timeoutTimer = setTimeout(
      () => {
        this.timeoutTimer = null;
        this.pending = [];
        const failedChunks = this.failUnconfirmed();
        this.callbacks.onAckTimeout(failedChunks);
      },
      Math.max(0, deadline - Date.now()),
    );
  }

  private failUnconfirmed(): boolean {
    const correlationIds = [
      ...new Set(this.unconfirmed.map((chunk) => chunk.correlationId)),
    ];
    this.unconfirmed = [];
    correlationIds.forEach((id) => this.callbacks.onDeliveryFailed(id));
    return correlationIds.length > 0;
  }

  private clearTimers(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}
