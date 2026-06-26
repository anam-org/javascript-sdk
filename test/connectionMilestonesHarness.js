const assert = require('assert');
const {
  ClientConnectionMilestoneRecorder,
} = require('../dist/main/lib/ConnectionMilestones');

const requests = [];
global.fetch = async (_url, options) => {
  requests.push(JSON.parse(options.body));
  return { ok: true };
};

const resetRequests = () => {
  requests.length = 0;
};

const getMetrics = (request) => request.metrics ?? [request];
const getSummaryMetric = (request) =>
  getMetrics(request).find(
    (metric) => metric.name === 'client_connection_milestones',
  );
const getDetailMetrics = (request) =>
  getMetrics(request).filter(
    (metric) => metric.name === 'client_connection_milestone',
  );
const assertNoSerializedMilestoneTag = (request) => {
  getMetrics(request).forEach((metric) => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(metric.tags, 'milestones'),
      false,
      `${metric.name} should not include serialized milestones tag`,
    );
  });
};

const createRecorder = ({
  sampleRatio = 0,
  slowThresholdMs = 5000,
  randomValue = 1,
  now,
}) =>
  new ClientConnectionMilestoneRecorder({
    context: {
      attemptCorrelationId: 'attempt-1',
      organizationId: 'org-1',
    },
    connectionMilestoneSampleRatio: sampleRatio,
    slowConnectionThresholdMs: slowThresholdMs,
    random: () => randomValue,
    now,
  });

async function runHarness() {
  let nowMs = 0;
  let recorder = createRecorder({ now: () => nowMs });
  nowMs = 100;
  recorder.recordSessionSuccess({ detectionMethod: 'harness' });
  assert.equal(
    requests.length,
    0,
    'normal unsampled success should not publish',
  );

  resetRequests();
  nowMs = 0;
  recorder = createRecorder({
    sampleRatio: 1,
    randomValue: 0.5,
    now: () => nowMs,
  });
  nowMs = 100;
  recorder.recordSessionSuccess({ detectionMethod: 'harness' });
  assert.equal(requests.length, 1, 'sampled success should publish once');
  assert.equal(getMetrics(requests[0]).length, 3);
  assertNoSerializedMilestoneTag(requests[0]);
  const sampledSummary = getSummaryMetric(requests[0]);
  const sampledDetails = getDetailMetrics(requests[0]);
  assert.equal(sampledSummary.tags.publishReason, 'sampled');
  assert.equal(sampledSummary.tags.milestoneCount, 2);
  assert.equal(sampledDetails.length, 2);
  assert.deepEqual(
    sampledDetails.map((metric) => metric.tags.milestone),
    ['client_session_attempt', 'client_session_success'],
  );
  assert.deepEqual(
    sampledDetails.map((metric) => metric.value),
    [0, 100],
  );
  assert.deepEqual(
    sampledDetails.map((metric) => metric.tags.sequence),
    [0, 1],
  );
  assert.equal(sampledDetails[1].tags.detectionMethod, 'harness');
  assert.equal(sampledDetails[1].tags.publishReason, 'sampled');

  resetRequests();
  nowMs = 0;
  recorder = createRecorder({
    slowThresholdMs: 50,
    now: () => nowMs,
  });
  nowMs = 75;
  recorder.recordSessionSuccess({ detectionMethod: 'harness' });
  assert.equal(requests.length, 1, 'slow success should publish once');
  assertNoSerializedMilestoneTag(requests[0]);
  const slowSummary = getSummaryMetric(requests[0]);
  const slowDetails = getDetailMetrics(requests[0]);
  assert.equal(slowSummary.tags.publishReason, 'slow');
  assert.equal(slowSummary.tags.attemptDurationMs, 75);
  assert.equal(slowDetails.length, 2);
  assert.deepEqual(
    slowDetails.map((metric) => metric.tags.milestone),
    ['client_session_attempt', 'client_session_success'],
  );

  resetRequests();
  nowMs = 0;
  recorder = createRecorder({ now: () => nowMs });
  nowMs = 25;
  recorder.publishFailure({ failureStage: 'harness' });
  assert.equal(requests.length, 1, 'failed attempt should publish once');
  assertNoSerializedMilestoneTag(requests[0]);
  const failureSummary = getSummaryMetric(requests[0]);
  const failureDetails = getDetailMetrics(requests[0]);
  assert.equal(failureSummary.tags.publishReason, 'failed');
  assert.equal(failureSummary.tags.failureStage, 'harness');
  assert.deepEqual(
    failureDetails.map((metric) => metric.tags.milestone),
    ['client_session_attempt', 'connection_attempt_failed'],
  );
  assert.equal(failureDetails[1].tags.failureStage, 'harness');
}

runHarness()
  .then(() => {
    console.log('connection milestone harness passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
