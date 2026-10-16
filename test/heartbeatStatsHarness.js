const assert = require('node:assert/strict');
const { mock } = require('node:test');
const {
  HeartbeatStats,
  HEARTBEAT_STATS_FLUSH_INTERVAL_MS,
} = require('../dist/main/lib/HeartbeatStats');

function setup() {
  const sent = [];
  const stats = new HeartbeatStats(async (metrics) => {
    sent.push(...metrics);
  });
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
  assert.deepEqual(sent[0].fields, {
    answers: 102,
    heartbeatTimeouts: 1,
    refusedChunks: 1,
    failedStreams: 2,
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

function testFailingSendDoesNotThrow() {
  const stats = new HeartbeatStats(() => {
    throw new Error('send failed');
  });
  stats.recordRoundTrip(10);
  stats.flush();
  const rejecting = new HeartbeatStats(() => Promise.reject(new Error('no')));
  rejecting.recordRoundTrip(10);
  rejecting.flush();
}

const tests = [
  testFlushReportsPercentilesAndCounts,
  testFlushResetsAndSkipsEmptyPeriods,
  testCountsWithoutAnswersOmitRoundTripFields,
  testFlushesPeriodicallyAndOnStop,
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
