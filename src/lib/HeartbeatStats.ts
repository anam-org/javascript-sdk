import {
  ClientMetricMeasurement,
  ClientMetricPayload,
  sendClientMetrics,
} from './ClientMetrics';

export const HEARTBEAT_STATS_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
// Share of sessions that report every window, including healthy ones. Other
// sessions report only windows where something went wrong.
export const HEARTBEAT_STATS_SAMPLE_RATIO = 0.05;
// An answer slower than this makes a window worth reporting from any session.
export const HEARTBEAT_STATS_SLOW_ANSWER_MS = 1000;

// Nearest-rank percentile of an ascending list.
const percentile = (sorted: number[], p: number): number =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

/**
 * Collects heartbeat answer round trips and delivery outcomes for a session and
 * reports them as one client_heartbeat metric per flush, every few minutes and when
 * signalling stops. The data is for tuning HEARTBEAT_ACK_TIMEOUT_MS and
 * HEARTBEAT_SUSPECT_MS.
 *
 * A window is always reported if it had a slow answer, a heartbeat timeout, a
 * refused chunk or a failed stream. Healthy windows are reported only from a
 * sampled share of sessions, marked sampled=1. Rates such as "how often an answer
 * takes over 1s" must use sampled=1 points only, since unsampled sessions report
 * nothing when healthy.
 */
export class HeartbeatStats {
  private roundTripsMs: number[] = [];
  private heartbeatTimeouts = 0;
  private refusedChunks = 0;
  private failedStreams = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private send: (metrics: ClientMetricPayload[]) => Promise<void>;
  private readonly sampled: boolean;

  constructor(send = sendClientMetrics, random = Math.random) {
    this.send = send;
    this.sampled = random() < HEARTBEAT_STATS_SAMPLE_RATIO;
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
    const slowAnswers = this.roundTripsMs.filter(
      (ms) => ms > HEARTBEAT_STATS_SLOW_ANSWER_MS,
    ).length;
    const notable =
      slowAnswers > 0 ||
      this.heartbeatTimeouts > 0 ||
      this.refusedChunks > 0 ||
      this.failedStreams > 0;
    const sorted = [...this.roundTripsMs].sort((a, b) => a - b);
    const fields: Record<string, number> = {
      answers,
      heartbeatTimeouts: this.heartbeatTimeouts,
      refusedChunks: this.refusedChunks,
      failedStreams: this.failedStreams,
      sampled: this.sampled ? 1 : 0,
    };
    if (answers > 0) {
      fields.p50Ms = percentile(sorted, 0.5);
      fields.p90Ms = percentile(sorted, 0.9);
      fields.p99Ms = percentile(sorted, 0.99);
      fields.maxMs = sorted[answers - 1];
      fields.over1s = slowAnswers;
      fields.over2s = sorted.filter((ms) => ms > 2000).length;
    }
    this.roundTripsMs = [];
    this.heartbeatTimeouts = 0;
    this.refusedChunks = 0;
    this.failedStreams = 0;
    if (!notable && !(this.sampled && answers > 0)) {
      return;
    }

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
