const assert = require('node:assert/strict');
const {
  InternalEventEmitter,
} = require('../dist/main/modules/InternalEventEmitter');
const { InternalEvent } = require('../dist/main/types');
const { TalkMessageStream } = require('../dist/main/types/TalkMessageStream');
const {
  TalkMessageStreamState,
} = require('../dist/main/types/TalkMessageStreamState');
const { mock } = require('node:test');
const { SignallingClient } = require('../dist/main/modules/SignallingClient');
const {
  PublicEventEmitter,
} = require('../dist/main/modules/PublicEventEmitter');
const { AnamEvent } = require('../dist/main/types');

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
  const sent = [];
  const stream = new TalkMessageStream(correlationId, internalEmitter, {
    sendTalkMessage: async (payload) => sent.push(payload),
  });
  return { stream, sent, internalEmitter };
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

async function testEndedStreamIgnoresDeliveryFailed() {
  const { stream, internalEmitter } = fakeStream();
  await stream.streamMessageChunk('a', true);
  internalEmitter.emit(InternalEvent.TALK_STREAM_DELIVERY_FAILED, 'corr-1');
  assert.equal(stream.getState(), TalkMessageStreamState.ENDED);
}

function listenerCount(emitter, event) {
  return emitter.listeners[event]?.size ?? 0;
}

async function testDeactivateRemovesListeners() {
  const { stream, internalEmitter } = fakeStream();
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.SIGNAL_MESSAGE_RECEIVED),
    1,
  );
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.TALK_STREAM_DELIVERY_FAILED),
    1,
  );
  await stream.streamMessageChunk('a', true);
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.SIGNAL_MESSAGE_RECEIVED),
    0,
  );
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.TALK_STREAM_DELIVERY_FAILED),
    0,
  );
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
  const stream = new TalkMessageStream('corr-1', internalEmitter, signalling);
  return { signalling, stream, log, signalled };
}

function advertiseAcks() {
  currentSocket().receive({
    actionType: 'sessionready',
    sessionId: 'session-1',
    payload: { talkStreamAcks: true },
  });
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

async function testNoTrackingWithoutEngineSupport() {
  const { stream } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('lost', false);
  mock.timers.tick(20000);
  assert.equal(FakeWebSocket.instances.length, 1);
}

async function testSessionReadyEnablesTrackingAndIsStillEmitted() {
  const { stream, signalled } = await connectedSignalling();
  advertiseAcks();
  assert.deepEqual(signalled, ['sessionready']);
  currentSocket().swallow = true;
  await stream.streamMessageChunk('hello', false);
  mock.timers.tick(3000);
  assert.equal(FakeWebSocket.instances.length, 2);
  await reopen();
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => [p.sequence, p.content]),
    [[0, 'hello']],
  );
}

async function testFirstAckEnablesTrackingAndIsNotEmitted() {
  const { stream, signalled } = await connectedSignalling();
  await stream.streamMessageChunk('one', false);
  ack(0);
  assert.deepEqual(signalled, []);
  currentSocket().swallow = true;
  await stream.streamMessageChunk('two', false);
  mock.timers.tick(3000);
  await reopen();
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => p.sequence),
    [1],
  );
}

async function testReplaysOnlyUnackedInOrder() {
  const { stream } = await connectedSignalling();
  advertiseAcks();
  await stream.streamMessageChunk('a', false);
  await stream.streamMessageChunk('b', false);
  await stream.streamMessageChunk('c', false);
  ack(1);
  currentSocket().swallow = true;
  await stream.streamMessageChunk('d', false);
  mock.timers.tick(3000);
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
  advertiseAcks();
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
  advertiseAcks();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('lost', false);
  mock.timers.tick(3000);
  mock.timers.tick(7000);
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.equal(stream.getState(), TalkMessageStreamState.DELIVERY_FAILED);
  await assert.rejects(() => stream.streamMessageChunk('more', false));
  await reopen();
  assert.deepEqual(talkSent(currentSocket()), []);
  mock.timers.tick(20000);
  assert.deepEqual(log, [['failed', 'corr-1']]);
}

async function testStopIsSilent() {
  const { signalling, stream, log } = await connectedSignalling();
  advertiseAcks();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('pending', false);
  signalling.stop();
  mock.timers.tick(20000);
  assert.deepEqual(log, []);
  assert.equal(FakeWebSocket.instances.length, 1);
}

async function testTerminalCloseFailsPendingBeforeConnectionClosed() {
  const { stream, log } = await connectedSignalling({
    maxWsReconnectionAttempts: 1,
  });
  advertiseAcks();
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
  advertiseAcks();
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

const signallingTests = [
  testNoTrackingWithoutEngineSupport,
  testSessionReadyEnablesTrackingAndIsStillEmitted,
  testFirstAckEnablesTrackingAndIsNotEmitted,
  testReplaysOnlyUnackedInOrder,
  testChunkSentWhileReconnectingIsReplayedOnce,
  testHoldTimeoutFailsStreamOnce,
  testStopIsSilent,
  testTerminalCloseFailsPendingBeforeConnectionClosed,
  testIceRestartReconnectReplays,
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
  await testEndedStreamIgnoresDeliveryFailed();
  await testDeactivateRemovesListeners();
  await runSignallingTests();
  console.log('talkStreamDeliveryHarness: all tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
