const assert = require('node:assert/strict');
const { mock } = require('node:test');
const {
  TalkStreamDeliveryTracker,
  TALK_STREAM_ACK_TIMEOUT_MS,
} = require('../dist/main/modules/TalkStreamDeliveryTracker');

function chunk(correlationId, sequence) {
  return {
    content: `chunk-${sequence}`,
    startOfSpeech: sequence === 0,
    endOfSpeech: false,
    correlationId,
    sequence,
  };
}

function setup() {
  const ackTimeouts = [];
  const failed = [];
  const tracker = new TalkStreamDeliveryTracker({
    onAckTimeout: () => ackTimeouts.push(Date.now()),
    onDeliveryFailed: (correlationId) => failed.push(correlationId),
  });
  return { tracker, ackTimeouts, failed };
}

function testCumulativeAckCoversEarlierChunks() {
  const { tracker, ackTimeouts, failed } = setup();
  [0, 1, 2, 3].forEach((s) => tracker.track(chunk('a', s)));
  tracker.ack('a', 1);
  tracker.failAll();
  assert.deepEqual(failed, ['a']);

  const second = setup();
  [0, 1, 2, 3].forEach((s) => second.tracker.track(chunk('a', s)));
  second.tracker.ack('a', 3);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(second.failed, []);
  assert.equal(second.ackTimeouts.length, 0);
  assert.equal(ackTimeouts.length, 0);
}

function testAckIsPerCorrelationId() {
  const { tracker, failed } = setup();
  tracker.track(chunk('a', 0));
  tracker.track(chunk('b', 0));
  tracker.ack('a', 0);
  tracker.ack('unknown', 5);
  tracker.failAll();
  assert.deepEqual(failed, ['b']);
}

function testAckTimeoutFailsEveryUnackedIdThenReportsOnce() {
  const { tracker, ackTimeouts, failed } = setup();
  tracker.track(chunk('a', 0));
  mock.timers.tick(1000);
  tracker.track(chunk('b', 0));
  tracker.track(chunk('a', 1));
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS - 1001);
  assert.equal(ackTimeouts.length, 0);
  mock.timers.tick(1);
  // Every unacked chunk was written to the socket presumed dead, including b,
  // whose own deadline had not passed yet.
  assert.deepEqual(failed, ['a', 'b']);
  assert.equal(ackTimeouts.length, 1);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(failed, ['a', 'b']);
  assert.equal(ackTimeouts.length, 1);
}

function testDeadlineFollowsOldestUnackedChunk() {
  const { tracker, ackTimeouts } = setup();
  tracker.track(chunk('a', 0));
  mock.timers.tick(2000);
  tracker.track(chunk('a', 1));
  tracker.ack('a', 0);
  // The deadline moves to chunk 1, sent 2s after chunk 0.
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS - 1);
  assert.equal(ackTimeouts.length, 0);
  mock.timers.tick(1);
  assert.equal(ackTimeouts.length, 1);
}

function testFailAllReportsEachIdOnceAndClears() {
  const { tracker, failed, ackTimeouts } = setup();
  tracker.track(chunk('a', 0));
  tracker.track(chunk('a', 1));
  tracker.track(chunk('b', 0));
  tracker.failAll();
  assert.deepEqual(failed, ['a', 'b']);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(failed, ['a', 'b']);
  assert.equal(ackTimeouts.length, 0);
}

function testClearIsSilent() {
  const { tracker, failed, ackTimeouts } = setup();
  tracker.track(chunk('a', 0));
  tracker.clear();
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS * 2);
  tracker.failAll();
  assert.deepEqual(failed, []);
  assert.equal(ackTimeouts.length, 0);
}

function testDropIsSilentAndPerCorrelationId() {
  const { tracker, failed, ackTimeouts } = setup();
  tracker.track(chunk('a', 0));
  tracker.track(chunk('a', 1));
  tracker.track(chunk('b', 0));
  tracker.drop('a');
  tracker.failAll();
  assert.deepEqual(failed, ['b']);

  const second = setup();
  second.tracker.track(chunk('a', 0));
  second.tracker.drop('a');
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(second.failed, []);
  assert.equal(second.ackTimeouts.length, 0);
  assert.equal(ackTimeouts.length, 0);
}

const tests = [
  testCumulativeAckCoversEarlierChunks,
  testAckIsPerCorrelationId,
  testAckTimeoutFailsEveryUnackedIdThenReportsOnce,
  testDeadlineFollowsOldestUnackedChunk,
  testFailAllReportsEachIdOnceAndClears,
  testClearIsSilent,
  testDropIsSilentAndPerCorrelationId,
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
