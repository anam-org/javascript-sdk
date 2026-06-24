export interface ConnectionMilestoneMetricsOptions {
  /**
   * Ratio of successful normal connection attempts that should publish detailed
   * connection milestones. Failed and slow attempts are published regardless.
   * Values are clamped to the 0-1 range.
   * @default 0
   */
  connectionMilestoneSampleRatio?: number;
  /**
   * Successful attempts with total connection setup time at or above this
   * threshold publish detailed connection milestones even when not sampled.
   * @default 5000
   */
  slowConnectionThresholdMs?: number;
}
