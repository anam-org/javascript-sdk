const assert = require('node:assert/strict');
const { mock } = require('node:test');
const {
  HeartbeatStats,
  HEARTBEAT_STATS_FLUSH_INTERVAL_MS,
} = require('../dist/main/lib/HeartbeatStats');

function setup({ sampled = true } = {}) {
  const sent = [];
  const stats = new HeartbeatStats(
    'session-1',
    async (metrics) => {
      sent.push(...metrics);
    },
    () => (sampled ? 0 : 0.99),
  );
  return { stats, sent };
}

function testFlushReportsPercentilesAndCounts() {
  const { stats, sent } = setup();
  for (let ms = 10; ms <= 1000; ms += 10) {
    stats.recordRoundTrip(ms);
  }
  stats.recordRoundTrip(1500);
  stats.recordRoundTrip(2500);
  stats.recordHeartbeatTimeout();
  stats.recordRefusedChunk();
  stats.recordFailedStream();
  stats.recordFailedStream();
  stats.flush();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, 'client_heartbeat');
  assert.equal(sent[0].value, 102);
  // The session's own id, not the process-wide context another client can change.
  assert.deepEqual(sent[0].tags, { sessionId: 'session-1' });
  assert.deepEqual(sent[0].fields, {
    answers: 102,
    heartbeatTimeouts: 1,
    refusedChunks: 1,
    failedStreams: 2,
    sampled: 1,
    p50Ms: 510,
    p90Ms: 920,
    p99Ms: 1500,
    maxMs: 2500,
    over1s: 2,
    over2s: 1,
  });
}

function testFlushResetsAndSkipsEmptyPeriods() {
  const { stats, sent } = setup();
  stats.flush();
  assert.equal(sent.length, 0);
  stats.recordRoundTrip(40);
  stats.flush();
  stats.flush();
  assert.equal(sent.length, 1);
}

function testCountsWithoutAnswersOmitRoundTripFields() {
  const { stats, sent } = setup();
  stats.recordHeartbeatTimeout();
  stats.flush();
  assert.deepEqual(sent[0].fields, {
    answers: 0,
    heartbeatTimeouts: 1,
    refusedChunks: 0,
    failedStreams: 0,
    sampled: 1,
  });
}

function testFlushesPeriodicallyAndOnStop() {
  const { stats, sent } = setup();
  stats.start();
  stats.start();
  stats.recordRoundTrip(30);
  mock.timers.tick(HEARTBEAT_STATS_FLUSH_INTERVAL_MS);
  assert.equal(sent.length, 1);
  stats.recordRoundTrip(50);
  stats.stop();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].fields.p50Ms, 50);
  stats.recordRoundTrip(60);
  mock.timers.tick(HEARTBEAT_STATS_FLUSH_INTERVAL_MS * 2);
  assert.equal(sent.length, 2);
}

function testUnsampledSessionDropsHealthyWindows() {
  const { stats, sent } = setup({ sampled: false });
  stats.recordRoundTrip(40);
  stats.recordRoundTrip(1000);
  stats.flush();
  assert.equal(sent.length, 0);
  // The dropped window is reset, not carried into the next one.
  stats.recordRoundTrip(1001);
  stats.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].fields.answers, 1);
  assert.equal(sent[0].fields.over1s, 1);
  assert.equal(sent[0].fields.sampled, 0);
}

function testUnsampledSessionReportsEveryKindOfProblem() {
  for (const record of [
    (stats) => stats.recordHeartbeatTimeout(),
    (stats) => stats.recordRefusedChunk(),
    (stats) => stats.recordFailedStream(),
  ]) {
    const { stats, sent } = setup({ sampled: false });
    stats.recordRoundTrip(40);
    record(stats);
    stats.flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].fields.sampled, 0);
  }
}

function testSamplingIsDecidedOncePerSession() {
  let calls = 0;
  const sent = [];
  const stats = new HeartbeatStats(
    'session-1',
    async (metrics) => {
      sent.push(...metrics);
    },
    () => {
      calls++;
      return 0;
    },
  );
  stats.recordRoundTrip(10);
  stats.flush();
  stats.recordRoundTrip(20);
  stats.flush();
  assert.equal(calls, 1);
  assert.equal(sent.length, 2);
}

function testFailingSendDoesNotThrow() {
  const stats = new HeartbeatStats(
    'session-1',
    () => {
      throw new Error('send failed');
    },
    () => 0,
  );
  stats.recordRoundTrip(10);
  stats.flush();
  const rejecting = new HeartbeatStats(
    'session-1',
    () => Promise.reject(new Error('no')),
    () => 0,
  );
  rejecting.recordRoundTrip(10);
  rejecting.flush();
}

const tests = [
  testFlushReportsPercentilesAndCounts,
  testFlushResetsAndSkipsEmptyPeriods,
  testCountsWithoutAnswersOmitRoundTripFields,
  testFlushesPeriodicallyAndOnStop,
  testUnsampledSessionDropsHealthyWindows,
  testUnsampledSessionReportsEveryKindOfProblem,
  testSamplingIsDecidedOncePerSession,
  testFailingSendDoesNotThrow,
];

for (const test of tests) {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_000_000 });
  try {
    test();
  } finally {
    mock.timers.reset();
  }
}
console.log('heartbeatStatsHarness: all tests passed');
