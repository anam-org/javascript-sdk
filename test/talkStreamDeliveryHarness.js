const assert = require('node:assert/strict');
const {
  InternalEventEmitter,
} = require('../dist/main/modules/InternalEventEmitter');
const { InternalEvent } = require('../dist/main/types');
const { TalkMessageStream } = require('../dist/main/types/TalkMessageStream');
const {
  TalkMessageStreamRegistry,
} = require('../dist/main/modules/TalkMessageStreamRegistry');
const {
  TalkMessageStreamState,
} = require('../dist/main/types/TalkMessageStreamState');
const { mock } = require('node:test');
const { SignallingClient } = require('../dist/main/modules/SignallingClient');
const {
  PublicEventEmitter,
} = require('../dist/main/modules/PublicEventEmitter');
const { AnamEvent } = require('../dist/main/types');
const {
  TALK_STREAM_ACK_TIMEOUT_MS,
  TALK_STREAM_MAX_HOLD_MS,
} = require('../dist/main/modules/TalkStreamDeliveryTracker');

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    // A half-open socket: writes succeed but never arrive.
    this.swallow = false;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    FakeWebSocket.instances.push(this);
  }

  send(data) {
    if (!this.swallow) {
      this.sent.push(JSON.parse(data));
    }
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  drop(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason: '', wasClean: false });
  }

  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}
globalThis.WebSocket = FakeWebSocket;

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));
const currentSocket = () => FakeWebSocket.instances.at(-1);
const talkSent = (socket) =>
  socket.sent
    .filter((m) => m.actionType === 'talkstream')
    .map((m) => m.payload);

function fakeStream(correlationId = 'corr-1') {
  const internalEmitter = new InternalEventEmitter();
  const registry = new TalkMessageStreamRegistry(internalEmitter);
  const sent = [];
  const stream = new TalkMessageStream(correlationId, {
    sendTalkMessage: async (payload) => sent.push(payload),
  });
  registry.register(stream);
  return { stream, sent, internalEmitter, registry };
}

function interrupt(emitter, correlationId = 'corr-1') {
  emitter.emit(InternalEvent.SIGNAL_MESSAGE_RECEIVED, {
    actionType: 'talkinputstreaminterrupted',
    sessionId: 'session-1',
    payload: { correlationId },
  });
}

async function testSequenceStampsEveryChunkAndTerminator() {
  const { stream, sent } = fakeStream();
  await stream.streamMessageChunk('a', false);
  await stream.streamMessageChunk('b', false);
  await stream.endMessage();
  assert.deepEqual(
    sent.map((p) => p.sequence),
    [0, 1, 2],
  );
}

async function testRejectedChunkDoesNotConsumeSequence() {
  const { stream, sent } = fakeStream();
  await assert.rejects(() => stream.streamMessageChunk('a', false, 'bad-id'));
  await stream.streamMessageChunk('a', true);
  assert.deepEqual(
    sent.map((p) => p.sequence),
    [0],
  );
}

async function testDeliveryFailedMakesActiveStreamTerminal() {
  const { stream, internalEmitter } = fakeStream();
  await stream.streamMessageChunk('a', false);
  internalEmitter.emit(InternalEvent.TALK_STREAM_DELIVERY_FAILED, 'other');
  assert.equal(stream.getState(), TalkMessageStreamState.STREAMING);
  internalEmitter.emit(InternalEvent.TALK_STREAM_DELIVERY_FAILED, 'corr-1');
  assert.equal(stream.getState(), TalkMessageStreamState.DELIVERY_FAILED);
  assert.equal(stream.isActive(), false);
  await assert.rejects(
    () => stream.streamMessageChunk('b', false),
    /not in an active state/,
  );
}

async function testEndedStreamStillReportsFailureAndInterruption() {
  // The final chunk can still be lost, and an ended turn can still be interrupted
  // while it plays.
  const failed = fakeStream();
  await failed.stream.streamMessageChunk('a', true);
  failed.internalEmitter.emit(
    InternalEvent.TALK_STREAM_DELIVERY_FAILED,
    'corr-1',
  );
  assert.equal(
    failed.stream.getState(),
    TalkMessageStreamState.DELIVERY_FAILED,
  );

  const interrupted = fakeStream();
  await interrupted.stream.streamMessageChunk('a', true);
  interrupted.internalEmitter.emit(InternalEvent.SIGNAL_MESSAGE_RECEIVED, {
    actionType: 'talkinputstreaminterrupted',
    sessionId: 'session-1',
    payload: { correlationId: 'corr-1' },
  });
  assert.equal(
    interrupted.stream.getState(),
    TalkMessageStreamState.INTERRUPTED,
  );
}

function listenerCount(emitter, event) {
  return emitter.listeners[event]?.size ?? 0;
}

async function testStreamsShareOneListenerPerEvent() {
  const internalEmitter = new InternalEventEmitter();
  const registry = new TalkMessageStreamRegistry(internalEmitter);
  const streams = ['a', 'b', 'c'].map((id) => {
    const stream = new TalkMessageStream(id, {
      sendTalkMessage: async () => {},
    });
    registry.register(stream);
    return stream;
  });
  for (const stream of streams) {
    await stream.streamMessageChunk('x', true);
  }
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.SIGNAL_MESSAGE_RECEIVED),
    1,
  );
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.TALK_STREAM_DELIVERY_FAILED),
    1,
  );
  interrupt(internalEmitter, 'b');
  assert.deepEqual(
    streams.map((stream) => stream.getState()),
    [
      TalkMessageStreamState.ENDED,
      TalkMessageStreamState.INTERRUPTED,
      TalkMessageStreamState.ENDED,
    ],
  );
}

async function testTerminalStreamsLeaveRegistry() {
  const { internalEmitter, registry } = fakeStream();
  assert.equal(registry.streams.size, 1);
  interrupt(internalEmitter);
  assert.equal(registry.streams.size, 0);

  const failed = fakeStream();
  failed.internalEmitter.emit(
    InternalEvent.TALK_STREAM_DELIVERY_FAILED,
    'corr-1',
  );
  assert.equal(failed.registry.streams.size, 0);
  // A terminal state is not overwritten by a later signal for the same id.
  interrupt(failed.internalEmitter);
  assert.equal(
    failed.stream.getState(),
    TalkMessageStreamState.DELIVERY_FAILED,
  );
}

async function testDroppedStreamIsPruned() {
  const internalEmitter = new InternalEventEmitter();
  const registry = new TalkMessageStreamRegistry(internalEmitter);
  (() => {
    registry.register(
      new TalkMessageStream('dropped', { sendTalkMessage: async () => {} }),
    );
  })();
  // A WeakRef target survives until the current job ends, so collect on a later turn.
  await flushPromises();
  global.gc();
  await flushPromises();
  const kept = new TalkMessageStream('kept', {
    sendTalkMessage: async () => {},
  });
  registry.register(kept);
  assert.deepEqual([...registry.streams.keys()], ['kept']);
}

async function connectedSignalling({ maxWsReconnectionAttempts } = {}) {
  FakeWebSocket.instances = [];
  const publicEmitter = new PublicEventEmitter();
  const internalEmitter = new InternalEventEmitter();
  const log = [];
  publicEmitter.addListener(AnamEvent.TALK_STREAM_DELIVERY_FAILED, (id) =>
    log.push(['failed', id]),
  );
  publicEmitter.addListener(AnamEvent.CONNECTION_CLOSED, (code) =>
    log.push(['closed', code]),
  );
  const signalled = [];
  internalEmitter.addListener(InternalEvent.SIGNAL_MESSAGE_RECEIVED, (m) =>
    signalled.push(m.actionType),
  );
  const signalling = new SignallingClient(
    'session-1',
    { url: { baseUrl: 'engine.test' }, maxWsReconnectionAttempts },
    publicEmitter,
    internalEmitter,
  );
  signalling.connect();
  currentSocket().open();
  await flushPromises();
  const registry = new TalkMessageStreamRegistry(internalEmitter);
  const stream = new TalkMessageStream('corr-1', signalling);
  registry.register(stream);
  return { signalling, stream, log, signalled, publicEmitter };
}

function ack(sequence, correlationId = 'corr-1') {
  currentSocket().receive({
    actionType: 'talkstreamack',
    sessionId: 'session-1',
    payload: { correlationId, sequence },
  });
}

async function reopen() {
  currentSocket().open();
  await flushPromises();
}

async function testHeldFromTheFirstChunk() {
  const { stream } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('hello', false);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS);
  assert.equal(FakeWebSocket.instances.length, 2);
  await reopen();
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => [p.sequence, p.content]),
    [[0, 'hello']],
  );
}

async function testAckIsConsumedNotEmitted() {
  const { stream, signalled } = await connectedSignalling();
  await stream.streamMessageChunk('one', false);
  ack(0);
  assert.deepEqual(signalled, []);
  currentSocket().swallow = true;
  await stream.streamMessageChunk('two', false);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS);
  await reopen();
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => p.sequence),
    [1],
  );
}

async function testReplaysOnlyUnackedInOrder() {
  const { stream } = await connectedSignalling();
  await stream.streamMessageChunk('a', false);
  await stream.streamMessageChunk('b', false);
  await stream.streamMessageChunk('c', false);
  ack(1);
  currentSocket().swallow = true;
  await stream.streamMessageChunk('d', false);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS);
  await reopen();
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => [p.sequence, p.content]),
    [
      [2, 'c'],
      [3, 'd'],
    ],
  );
}

async function testChunkSentWhileReconnectingIsReplayedOnce() {
  const { stream } = await connectedSignalling();
  currentSocket().drop();
  await flushPromises();
  await stream.streamMessageChunk('queued', false);
  mock.timers.tick(100);
  assert.equal(FakeWebSocket.instances.length, 2);
  await reopen();
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => p.content),
    ['queued'],
  );
}

async function testHoldTimeoutFailsStreamOnce() {
  const { stream, log } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('lost', false);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS);
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS - TALK_STREAM_ACK_TIMEOUT_MS);
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.equal(stream.getState(), TalkMessageStreamState.DELIVERY_FAILED);
  await assert.rejects(() => stream.streamMessageChunk('more', false));
  await reopen();
  assert.deepEqual(talkSent(currentSocket()), []);
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS * 2);
  assert.deepEqual(log, [['failed', 'corr-1']]);
}

async function testInterruptionDropsHeldChunksSilently() {
  const { stream, log } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('a', true);
  currentSocket().receive({
    actionType: 'talkinputstreaminterrupted',
    sessionId: 'session-1',
    payload: { correlationId: 'corr-1' },
  });
  await flushPromises();
  assert.equal(stream.getState(), TalkMessageStreamState.INTERRUPTED);
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS * 2);
  assert.deepEqual(log, []);
  assert.equal(FakeWebSocket.instances.length, 1);
}

async function testStopIsSilent() {
  const { signalling, stream, log } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('pending', false);
  signalling.stop();
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS * 2);
  assert.deepEqual(log, []);
  assert.equal(FakeWebSocket.instances.length, 1);
}

async function testTerminalCloseFailsPendingBeforeConnectionClosed() {
  const { stream, log } = await connectedSignalling({
    maxWsReconnectionAttempts: 1,
  });
  await stream.streamMessageChunk('pending', false);
  currentSocket().drop();
  await flushPromises();
  mock.timers.tick(100);
  currentSocket().drop();
  await flushPromises();
  assert.deepEqual(
    log.map(([kind]) => kind),
    ['failed', 'closed'],
  );
}

async function testIceRestartReconnectReplays() {
  const { signalling, stream } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('hello', false);
  signalling.reconnectForIceRestart();
  assert.equal(FakeWebSocket.instances.length, 2);
  await reopen();
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => p.content),
    ['hello'],
  );
}

async function testChunkAfterStopIsNotHeld() {
  const { signalling, stream, log } = await connectedSignalling();
  signalling.stop();
  await stream.streamMessageChunk('late', false);
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS * 2);
  assert.deepEqual(log, []);
  assert.equal(stream.getState(), TalkMessageStreamState.STREAMING);
}

async function testChunkAfterTerminalCloseIsNotHeld() {
  const { stream, log } = await connectedSignalling({
    maxWsReconnectionAttempts: 1,
  });
  currentSocket().drop();
  await flushPromises();
  mock.timers.tick(100);
  currentSocket().drop();
  await flushPromises();
  await stream.streamMessageChunk('late', false);
  mock.timers.tick(TALK_STREAM_MAX_HOLD_MS * 2);
  assert.deepEqual(
    log.map(([kind]) => kind),
    ['closed'],
  );
}

async function testThrowingFailureListenerDoesNotBlockConnectionClosed() {
  const { signalling, stream, log, publicEmitter } = await connectedSignalling({
    maxWsReconnectionAttempts: 1,
  });
  publicEmitter.addListener(AnamEvent.TALK_STREAM_DELIVERY_FAILED, () => {
    throw new Error('listener bug');
  });
  await stream.streamMessageChunk('pending', false);
  currentSocket().drop();
  await flushPromises();
  mock.timers.tick(100);
  currentSocket().drop();
  await flushPromises();
  assert.deepEqual(
    log.map(([kind]) => kind),
    ['failed', 'closed'],
  );
  assert.equal(signalling.isPermanentlyClosed(), true);
}

// Drops the current socket and lets the backoff open the next one, closeCount times.
async function dropRepeatedly(closeCount) {
  for (let attempt = 1; attempt <= closeCount; attempt += 1) {
    currentSocket().drop();
    await flushPromises();
    mock.timers.tick(100 * attempt);
  }
}

async function testAckTimeoutReplaceGetsExtendedRetryBudgetUntilStable() {
  const { signalling, stream, log } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('hello', false);
  mock.timers.tick(TALK_STREAM_ACK_TIMEOUT_MS);
  // The default budget (5) would give up on the 6th close; a network switch needs
  // the same headroom an ICE-restart reconnect gets.
  await dropRepeatedly(6);
  assert.equal(signalling.isPermanentlyClosed(), false);
  await reopen();
  ack(0);
  // Once the replacement has been stable, the default budget applies again.
  mock.timers.tick(5000);
  await dropRepeatedly(6);
  assert.equal(signalling.isPermanentlyClosed(), true);
  assert.deepEqual(
    log.map(([kind]) => kind),
    ['closed'],
  );
}

const signallingTests = [
  testHeldFromTheFirstChunk,
  testAckIsConsumedNotEmitted,
  testReplaysOnlyUnackedInOrder,
  testChunkSentWhileReconnectingIsReplayedOnce,
  testHoldTimeoutFailsStreamOnce,
  testStopIsSilent,
  testInterruptionDropsHeldChunksSilently,
  testTerminalCloseFailsPendingBeforeConnectionClosed,
  testIceRestartReconnectReplays,
  testChunkAfterStopIsNotHeld,
  testChunkAfterTerminalCloseIsNotHeld,
  testThrowingFailureListenerDoesNotBlockConnectionClosed,
  testAckTimeoutReplaceGetsExtendedRetryBudgetUntilStable,
];

async function runSignallingTests() {
  for (const test of signallingTests) {
    mock.timers.enable({
      apis: ['setTimeout', 'setInterval', 'Date'],
      now: 1_000_000,
    });
    try {
      await test();
    } finally {
      mock.timers.reset();
    }
  }
}

async function main() {
  await testSequenceStampsEveryChunkAndTerminator();
  await testRejectedChunkDoesNotConsumeSequence();
  await testDeliveryFailedMakesActiveStreamTerminal();
  await testEndedStreamStillReportsFailureAndInterruption();
  await testStreamsShareOneListenerPerEvent();
  await testTerminalStreamsLeaveRegistry();
  await testDroppedStreamIsPruned();
  await runSignallingTests();
  console.log('talkStreamDeliveryHarness: all tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
