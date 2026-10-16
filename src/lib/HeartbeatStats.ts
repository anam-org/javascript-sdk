import {
  ClientMetricMeasurement,
  ClientMetricPayload,
  sendClientMetrics,
} from './ClientMetrics';

export const HEARTBEAT_STATS_FLUSH_INTERVAL_MS = 5 * 60 * 1000;

// Nearest-rank percentile of an ascending list.
const percentile = (sorted: number[], p: number): number =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

/**
 * Collects heartbeat answer round trips and delivery outcomes for a session and
 * reports them as one client_heartbeat metric per flush, every few minutes and when
 * signalling stops. The data is for tuning HEARTBEAT_ACK_TIMEOUT_MS and
 * HEARTBEAT_SUSPECT_MS.
 */
export class HeartbeatStats {
  private roundTripsMs: number[] = [];
  private heartbeatTimeouts = 0;
  private refusedChunks = 0;
  private failedStreams = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private send: (metrics: ClientMetricPayload[]) => Promise<void>;

  constructor(send = sendClientMetrics) {
    this.send = send;
  }

  public start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(
      () => this.flush(),
      HEARTBEAT_STATS_FLUSH_INTERVAL_MS,
    );
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  public recordRoundTrip(ms: number): void {
    this.roundTripsMs.push(ms);
  }

  // A heartbeat went unanswered and the socket was replaced.
  public recordHeartbeatTimeout(): void {
    this.heartbeatTimeouts++;
  }

  // A chunk was refused without being written because a heartbeat was overdue.
  public recordRefusedChunk(): void {
    this.refusedChunks++;
  }

  public recordFailedStream(): void {
    this.failedStreams++;
  }

  public flush(): void {
    const answers = this.roundTripsMs.length;
    if (
      answers === 0 &&
      this.heartbeatTimeouts === 0 &&
      this.refusedChunks === 0 &&
      this.failedStreams === 0
    ) {
      return;
    }
    const sorted = [...this.roundTripsMs].sort((a, b) => a - b);
    const fields: Record<string, number> = {
      answers,
      heartbeatTimeouts: this.heartbeatTimeouts,
      refusedChunks: this.refusedChunks,
      failedStreams: this.failedStreams,
    };
    if (answers > 0) {
      fields.p50Ms = percentile(sorted, 0.5);
      fields.p90Ms = percentile(sorted, 0.9);
      fields.p99Ms = percentile(sorted, 0.99);
      fields.maxMs = sorted[answers - 1];
      fields.over1s = sorted.filter((ms) => ms > 1000).length;
      fields.over2s = sorted.filter((ms) => ms > 2000).length;
    }
    this.roundTripsMs = [];
    this.heartbeatTimeouts = 0;
    this.refusedChunks = 0;
    this.failedStreams = 0;

    try {
      void this.send([
        {
          name: ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_HEARTBEAT,
          value: answers,
          fields,
        },
      ]).catch(() => {
        // Client telemetry is non-critical and must not affect the session.
      });
    } catch {
      // Protect signalling from synchronous test doubles.
    }
  }
}
