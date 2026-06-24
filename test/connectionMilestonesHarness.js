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

const parseMilestones = (request) => JSON.parse(request.tags.milestones);

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
  assert.equal(requests[0].name, 'client_connection_milestones');
  assert.equal(requests[0].tags.publishReason, 'sampled');
  assert.deepEqual(
    parseMilestones(requests[0]).map((milestone) => milestone.name),
    ['client_session_attempt', 'client_session_success'],
  );

  resetRequests();
  nowMs = 0;
  recorder = createRecorder({
    slowThresholdMs: 50,
    now: () => nowMs,
  });
  nowMs = 75;
  recorder.recordSessionSuccess({ detectionMethod: 'harness' });
  assert.equal(requests.length, 1, 'slow success should publish once');
  assert.equal(requests[0].tags.publishReason, 'slow');
  assert.equal(requests[0].tags.attemptDurationMs, 75);

  resetRequests();
  nowMs = 0;
  recorder = createRecorder({ now: () => nowMs });
  nowMs = 25;
  recorder.publishFailure({ failureStage: 'harness' });
  assert.equal(requests.length, 1, 'failed attempt should publish once');
  assert.equal(requests[0].tags.publishReason, 'failed');
  assert.equal(requests[0].tags.failureStage, 'harness');
}

runHarness()
  .then(() => {
    console.log('connection milestone harness passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
