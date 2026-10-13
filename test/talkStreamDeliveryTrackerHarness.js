const assert = require('node:assert/strict');
const { mock } = require('node:test');
const {
  TalkStreamDeliveryTracker,
  TALK_STREAM_ACK_TIMEOUT_MS,
  TALK_STREAM_MAX_HOLD_MS,
} = require('../dist/main/modules/TalkStreamDeliveryTracker');

function message(correlationId, sequence) {
  return {
    actionType: 'talkstream',
    sessionId: 'session-1',
    payload: {
      content: `chunk-${sequence}`,
      startOfSpeech: sequence === 0,
      endOfSpeech: false,
      correlationId,
      sequence,
    },
  };
}

function setup() {
  const ackTimeouts = [];
  const failed = [];
  const tracker = new TalkStreamDeliveryTracker({
    onAckTimeout: () => ackTimeouts.push(Date.now()),
    onDeliveryFailed: (correlationId) => failed.push(correlationId),
  });
  tracker.enable();
  return { tracker, ackTimeouts, failed };
}

const sequences = (tracker) => tracker.pending().map((m) => m.payload.sequence);

function testDisabledByDefault() {
  const tracker = new TalkStreamDeliveryTracker({
    onAckTimeout() {},
    onDeliveryFailed() {},
  });
  assert.equal(tracker.isEnabled(), false);
  tracker.enable();
  assert.equal(tracker.isEnabled(), true);
}

function testCumulativeAckRemovesUpToSequence() {
  const { tracker } = setup();
  [0, 1, 2, 3].forEach((s) => tracker.track(message('a', s), true));
  tracker.ack('a', 1);
  assert.deepEqual(sequences(tracker), [2, 3]);
  tracker.ack('a', 3);
  assert.deepEqual(tracker.pending(), []);
  tracker.clear();
}

function testAckIsPerCorrelationId() {
  const { tracker } = setup();
  tracker.track(message('a', 0), true);
  tracker.track(message('b', 0), true);
  tracker.ack('a', 0);
  assert.deepEqual(
    tracker.pending().map((m) => m.payload.correlationId),
    ['b'],
  );
  tracker.ack('unknown', 5);
  assert.equal(tracker.pending().length, 1);
  tracker.clear();
}

function testAckTimeoutFiresForUnackedSentChunk() {
  const { tracker, ackTimeouts, failed } = setup();
  tracker.track(message('a', 0), true);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS - 1);
  assert.equal(ackTimeouts.length, 0);
  mock.timers.tick(1);
  assert.equal(ackTimeouts.length, 1);
  // The socket is presumed dead, so the chunk waits for a replay rather than
  // timing out again on every tick.
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS);
  assert.equal(ackTimeouts.length, 1);
  assert.deepEqual(failed, []);
  tracker.clear();
}

function testAckBeforeTimeoutPreventsIt() {
  const { tracker, ackTimeouts } = setup();
  tracker.track(message('a', 0), true);
  mock.timers.tick(1000);
  tracker.ack('a', 0);
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS);
  assert.equal(ackTimeouts.length, 0);
}

function testUnsentChunkHasNoAckDeadline() {
  const { tracker, ackTimeouts } = setup();
  tracker.track(message('a', 0), false);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS * 2);
  assert.equal(ackTimeouts.length, 0);
  tracker.markAllSent();
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS);
  assert.equal(ackTimeouts.length, 1);
  tracker.clear();
}

function testHoldDeadlineFailsOnlyThatCorrelationIdOnce() {
  const { tracker, failed } = setup();
  tracker.track(message('a', 0), false);
  mock.timers.tick(5000);
  tracker.track(message('b', 0), false);
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS - 5000);
  assert.deepEqual(failed, ['a']);
  assert.deepEqual(
    tracker.pending().map((m) => m.payload.correlationId),
    ['b'],
  );
  mock.timers.tick(5000);
  assert.deepEqual(failed, ['a', 'b']);
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS);
  assert.deepEqual(failed, ['a', 'b']);
}

function testHoldDeadlineDropsWholeCorrelationId() {
  const { tracker, failed } = setup();
  tracker.track(message('a', 0), false);
  mock.timers.tick(9000);
  tracker.track(message('a', 1), false);
  mock.timers.tick(1000);
  assert.deepEqual(failed, ['a']);
  assert.deepEqual(tracker.pending(), []);
}

function testFailAllReportsEachIdOnceAndClears() {
  const { tracker, failed } = setup();
  tracker.track(message('a', 0), true);
  tracker.track(message('a', 1), true);
  tracker.track(message('b', 0), true);
  tracker.failAll();
  assert.deepEqual(failed, ['a', 'b']);
  assert.deepEqual(tracker.pending(), []);
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS);
  assert.deepEqual(failed, ['a', 'b']);
}

function testClearIsSilent() {
  const { tracker, failed, ackTimeouts } = setup();
  tracker.track(message('a', 0), true);
  tracker.clear();
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS * 2);
  assert.deepEqual(failed, []);
  assert.equal(ackTimeouts.length, 0);
  assert.deepEqual(tracker.pending(), []);
}

const tests = [
  testDisabledByDefault,
  testCumulativeAckRemovesUpToSequence,
  testAckIsPerCorrelationId,
  testAckTimeoutFiresForUnackedSentChunk,
  testAckBeforeTimeoutPreventsIt,
  testUnsentChunkHasNoAckDeadline,
  testHoldDeadlineFailsOnlyThatCorrelationIdOnce,
  testHoldDeadlineDropsWholeCorrelationId,
  testFailAllReportsEachIdOnceAndClears,
  testClearIsSilent,
];

for (const test of tests) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    test();
  } finally {
    mock.timers.reset();
  }
}
console.log('talkStreamDeliveryTrackerHarness: all tests passed');
