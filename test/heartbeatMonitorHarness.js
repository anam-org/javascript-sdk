const assert = require('node:assert/strict');
const { mock } = require('node:test');
const {
  HeartbeatMonitor,
  HEARTBEAT_ACK_TIMEOUT_MS,
  HEARTBEAT_SUSPECT_MS,
  HEARTBEAT_PROBE_COALESCE_MS,
} = require('../dist/main/modules/HeartbeatMonitor');

function setup({ socketOpen = true } = {}) {
  const sent = [];
  const timeouts = [];
  const failed = [];
  const roundTrips = [];
  const monitor = new HeartbeatMonitor({
    sendHeartbeat: (seq) => {
      if (socketOpen) {
        sent.push(seq);
      }
      return socketOpen;
    },
    onAckTimeout: (failedChunks) => timeouts.push(failedChunks),
    onDeliveryFailed: (correlationId) => failed.push(correlationId),
    onRoundTrip: (ms) => roundTrips.push(ms),
  });
  return { monitor, sent, timeouts, failed, roundTrips };
}

function testBeatsCarryIncreasingSeqAndAnswersClearThem() {
  const { monitor, sent, timeouts } = setup();
  monitor.beat();
  monitor.beat();
  assert.deepEqual(sent, [0, 1]);
  // Cumulative: answering 1 also covers 0.
  monitor.onAck(1);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(timeouts, []);
}

function testChunksShareOneProbe() {
  const { monitor, sent } = setup();
  monitor.trackChunk('a');
  monitor.trackChunk('a');
  monitor.trackChunk('b');
  assert.deepEqual(sent, []);
  mock.timers.tick(0);
  assert.deepEqual(sent, [0]);
  monitor.clear();
}

function testProbeWaitsOutCoalescingWindow() {
  const { monitor, sent } = setup();
  monitor.beat();
  mock.timers.tick(40);
  monitor.trackChunk('a');
  mock.timers.tick(HEARTBEAT_PROBE_COALESCE_MS - 41);
  assert.deepEqual(sent, [0]);
  mock.timers.tick(1);
  assert.deepEqual(sent, [0, 1]);
  monitor.clear();
}

function testOnlyALaterHeartbeatConfirmsAChunk() {
  const { monitor, sent, timeouts, failed } = setup();
  monitor.beat();
  monitor.trackChunk('a');
  // Heartbeat 0 was written before the chunk, so its answer proves nothing about it.
  monitor.onAck(0);
  mock.timers.tick(HEARTBEAT_PROBE_COALESCE_MS);
  assert.deepEqual(sent, [0, 1]);
  monitor.onAck(1);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(failed, []);
  assert.deepEqual(timeouts, []);
}

function testTimeoutFailsEveryUnconfirmedIdOnce() {
  const { monitor, timeouts, failed } = setup();
  monitor.trackChunk('a');
  monitor.trackChunk('b');
  monitor.trackChunk('a');
  mock.timers.tick(0);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS - 1);
  assert.deepEqual(failed, []);
  mock.timers.tick(1);
  assert.deepEqual(failed, ['a', 'b']);
  assert.deepEqual(timeouts, [true]);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(failed, ['a', 'b']);
  assert.deepEqual(timeouts, [true]);
}

function testIdleTimeoutReportsNoChunks() {
  const { monitor, timeouts, failed } = setup();
  monitor.beat();
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS);
  assert.deepEqual(timeouts, [false]);
  assert.deepEqual(failed, []);
}

function testDeadlineFollowsOldestUnansweredHeartbeat() {
  const { monitor, timeouts } = setup();
  monitor.beat();
  mock.timers.tick(2000);
  monitor.beat();
  monitor.onAck(0);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS - 1);
  assert.deepEqual(timeouts, []);
  mock.timers.tick(1);
  assert.deepEqual(timeouts, [false]);
}

function testSuspectOnceAHeartbeatIsOverdue() {
  const { monitor } = setup();
  assert.equal(monitor.isSuspect(), false);
  monitor.beat();
  mock.timers.tick(HEARTBEAT_SUSPECT_MS - 1);
  assert.equal(monitor.isSuspect(), false);
  mock.timers.tick(1);
  assert.equal(monitor.isSuspect(), true);
  monitor.onAck(0);
  assert.equal(monitor.isSuspect(), false);
}

function testUnsentHeartbeatIsNotAwaited() {
  const { monitor, timeouts } = setup({ socketOpen: false });
  monitor.beat();
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(timeouts, []);
  assert.equal(monitor.isSuspect(), false);
}

function testResetFailsChunksAndForgetsHeartbeats() {
  const { monitor, timeouts, failed } = setup();
  monitor.beat();
  monitor.trackChunk('a');
  monitor.reset();
  assert.deepEqual(failed, ['a']);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(failed, ['a']);
  assert.deepEqual(timeouts, []);
}

function testDropAndClearAreSilent() {
  const { monitor, timeouts, failed } = setup();
  monitor.trackChunk('a');
  monitor.trackChunk('b');
  monitor.drop('a');
  monitor.reset();
  assert.deepEqual(failed, ['b']);

  const second = setup();
  second.monitor.trackChunk('a');
  mock.timers.tick(0);
  second.monitor.clear();
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(second.failed, []);
  assert.deepEqual(second.timeouts, []);
  assert.deepEqual(timeouts, []);
}

function testDisabledMonitorStillBeatsButTracksNothing() {
  const { monitor, sent, timeouts, failed } = setup();
  monitor.trackChunk('a');
  monitor.disable();
  monitor.trackChunk('b');
  monitor.beat();
  assert.deepEqual(sent, [0]);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(failed, []);
  assert.deepEqual(timeouts, []);
  assert.equal(monitor.isSuspect(), false);
}

function testRoundTripIsMeasuredPerAnsweredHeartbeat() {
  const { monitor, roundTrips } = setup();
  monitor.beat();
  mock.timers.tick(30);
  monitor.beat();
  mock.timers.tick(50);
  monitor.onAck(0);
  monitor.onAck(1);
  // A repeated or unknown answer has nothing left to measure.
  monitor.onAck(1);
  monitor.onAck(9);
  assert.deepEqual(roundTrips, [80, 50]);
}

const tests = [
  testRoundTripIsMeasuredPerAnsweredHeartbeat,
  testBeatsCarryIncreasingSeqAndAnswersClearThem,
  testChunksShareOneProbe,
  testProbeWaitsOutCoalescingWindow,
  testOnlyALaterHeartbeatConfirmsAChunk,
  testTimeoutFailsEveryUnconfirmedIdOnce,
  testIdleTimeoutReportsNoChunks,
  testDeadlineFollowsOldestUnansweredHeartbeat,
  testSuspectOnceAHeartbeatIsOverdue,
  testUnsentHeartbeatIsNotAwaited,
  testResetFailsChunksAndForgetsHeartbeats,
  testDropAndClearAreSilent,
  testDisabledMonitorStillBeatsButTracksNothing,
];

for (const test of tests) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    test();
  } finally {
    mock.timers.reset();
  }
}
console.log('heartbeatMonitorHarness: all tests passed');
