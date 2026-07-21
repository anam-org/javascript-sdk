import {
  AnamMetricsContext,
  ClientMetricPayload,
  ClientMetricMeasurement,
  sendClientMetrics,
} from './ClientMetrics';
import { ConnectionMilestoneMetricsOptions } from '../types/ConnectionMilestoneMetricsOptions';

export const DEFAULT_CONNECTION_MILESTONE_SAMPLE_RATIO = 0;
export const DEFAULT_SLOW_CONNECTION_THRESHOLD_MS = 5000;

type ConnectionMilestonePublishReason = 'sampled' | 'slow' | 'failed';
type ConnectionMilestoneTagValue = string | number | boolean;
type ConnectionMilestoneTags = Record<
  string,
  ConnectionMilestoneTagValue | null | undefined
>;

interface ClientConnectionMilestone {
  name: string;
  elapsedMs: number;
  clientTimestamp: string;
  tags?: Record<string, ConnectionMilestoneTagValue>;
}

interface ClientConnectionMilestoneRecorderOptions
  extends ConnectionMilestoneMetricsOptions {
  context?: Partial<AnamMetricsContext>;
  now?: () => number;
  random?: () => number;
}

export class ClientConnectionMilestoneRecorder {
  private readonly now: () => number;
  private readonly attemptStartedAtMs: number;
  private readonly sampleRatio: number;
  private readonly slowConnectionThresholdMs: number;
  private readonly sampled: boolean;
  private readonly milestones: ClientConnectionMilestone[] = [];

  private context: AnamMetricsContext = {
    sessionId: null,
    organizationId: null,
    attemptCorrelationId: null,
  };
  private published = false;
  private sessionSuccessful = false;

  constructor(options: ClientConnectionMilestoneRecorderOptions = {}) {
    this.now = options.now ?? getMonotonicNow;
    this.attemptStartedAtMs = this.now();
    this.sampleRatio = clampRatio(
      options.connectionMilestoneSampleRatio ??
        DEFAULT_CONNECTION_MILESTONE_SAMPLE_RATIO,
    );
    this.slowConnectionThresholdMs = Math.max(
      0,
      finiteNumberOrDefault(
        options.slowConnectionThresholdMs,
        DEFAULT_SLOW_CONNECTION_THRESHOLD_MS,
      ),
    );
    this.sampled = (options.random ?? Math.random)() < this.sampleRatio;

    this.updateContext(options.context ?? {});
    this.record('client_session_attempt');
  }

  public updateContext(context: Partial<AnamMetricsContext>) {
    this.context = { ...this.context, ...context };
  }

  public record(name: string, tags?: ConnectionMilestoneTags) {
    if (this.published) {
      return;
    }

    const sanitizedTags = sanitizeMilestoneTags(tags);
    const milestone: ClientConnectionMilestone = {
      name,
      elapsedMs: this.elapsedMs(),
      clientTimestamp: new Date().toISOString(),
    };
    if (Object.keys(sanitizedTags).length > 0) {
      milestone.tags = sanitizedTags;
    }
    this.milestones.push(milestone);
  }

  public recordSessionSuccess(tags?: ConnectionMilestoneTags) {
    if (this.sessionSuccessful) {
      return;
    }

    this.sessionSuccessful = true;
    this.record('client_session_success', tags);
    this.publishIfNeeded();
    // Once the success/publish decision has been made the recorder is done.
    // Stop accumulating and release the buffer for the rest of the
    // (potentially long-lived) session. Without this, a fast unsampled success
    // — the default path, since connectionMilestoneSampleRatio defaults to 0 —
    // never sets `published`, so the long-lived ICE/websocket event handlers
    // keep appending to `milestones` for the entire call.
    this.finalize();
  }

  /**
   * Make the recorder inert and release its buffer. `published` gates
   * record()/publish()/publishFailure(), so flipping it here stops all further
   * recording and publishing. publish() (if it ran) already built the metric
   * payloads synchronously, so clearing the buffer afterwards is safe.
   */
  private finalize() {
    this.published = true;
    this.milestones.length = 0;
  }

  public publishFailure(tags?: ConnectionMilestoneTags) {
    if (this.sessionSuccessful || this.published) {
      return;
    }

    this.record('connection_attempt_failed', tags);
    this.publish('failed', tags);
  }

  public publishIfNeeded() {
    if (this.published) {
      return;
    }

    if (this.elapsedMs() >= this.slowConnectionThresholdMs) {
      this.publish('slow');
      return;
    }

    if (this.sampled) {
      this.publish('sampled');
    }
  }

  private publish(
    reason: ConnectionMilestonePublishReason,
    tags?: ConnectionMilestoneTags,
  ) {
    if (this.published || this.milestones.length === 0) {
      return;
    }

    this.published = true;
    const summaryTags = sanitizeMetricTags({
      ...tags,
      ...this.context,
      publishReason: reason,
      attemptDurationMs: this.elapsedMs(),
      milestoneCount: this.milestones.length,
      connectionMilestoneSampleRatio: this.sampleRatio,
      slowConnectionThresholdMs: this.slowConnectionThresholdMs,
      wasSampled: this.sampled ? 1 : 0,
    });

    const metrics: ClientMetricPayload[] = [
      {
        name: ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_CONNECTION_MILESTONES,
        value: '1',
        tags: summaryTags,
      },
      ...this.milestones.map((milestone, index) => ({
        name: ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_CONNECTION_MILESTONE,
        value: milestone.elapsedMs,
        clientTimestamp: milestone.clientTimestamp,
        tags: sanitizeMetricTags({
          ...this.context,
          publishReason: reason,
          milestone: milestone.name,
          sequence: index,
          ...milestone.tags,
        }),
      })),
    ];

    void sendClientMetrics(metrics);
  }

  private elapsedMs(): number {
    return Math.max(0, Math.round(this.now() - this.attemptStartedAtMs));
  }
}

const getMonotonicNow = () => {
  if (typeof performance !== 'undefined') {
    return performance.now();
  }
  return Date.now();
};

const clampRatio = (value: number): number => {
  const finiteValue = finiteNumberOrDefault(
    value,
    DEFAULT_CONNECTION_MILESTONE_SAMPLE_RATIO,
  );
  return Math.min(1, Math.max(0, finiteValue));
};

const finiteNumberOrDefault = (value: unknown, fallback: number): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const sanitizeMilestoneTags = (
  tags?: ConnectionMilestoneTags,
): Record<string, ConnectionMilestoneTagValue> => {
  if (!tags) {
    return {};
  }

  const sanitizedTags: Record<string, ConnectionMilestoneTagValue> = {};
  Object.entries(tags).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return;
    }
    sanitizedTags[key] = value;
  });
  return sanitizedTags;
};

const sanitizeMetricTags = (
  tags: ConnectionMilestoneTags,
): Record<string, string | number> => {
  const metricTags: Record<string, string | number> = {};
  Object.entries(sanitizeMilestoneTags(tags)).forEach(([key, value]) => {
    metricTags[key] = typeof value === 'boolean' ? String(value) : value;
  });
  return metricTags;
};
