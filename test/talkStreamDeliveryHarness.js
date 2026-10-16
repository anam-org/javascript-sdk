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
  HEARTBEAT_ACK_TIMEOUT_MS,
  HEARTBEAT_SUSPECT_MS,
  HEARTBEAT_PROBE_COALESCE_MS,
} = require('../dist/main/modules/HeartbeatMonitor');

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
// Heartbeat stats are reported through fetch; tests that check them replace this.
global.fetch = async () => {};

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

// A long default interval keeps scheduled heartbeats out of tests that don't want them.
async function connectedSignalling({
  maxWsReconnectionAttempts,
  heartbeatIntervalSeconds = 600,
} = {}) {
  FakeWebSocket.instances = [];
  const publicEmitter = new PublicEventEmitter();
  const internalEmitter = new InternalEventEmitter();
  const log = [];
  publicEmitter.addListener(AnamEvent.MESSAGE_DELIVERY_FAILED, (failure) => {
    assert.equal(failure.messageType, 'talkStream');
    log.push(['failed', failure.correlationId]);
  });
  publicEmitter.addListener(AnamEvent.CONNECTION_CLOSED, (code) =>
    log.push(['closed', code]),
  );
  const signalled = [];
  internalEmitter.addListener(InternalEvent.SIGNAL_MESSAGE_RECEIVED, (m) =>
    signalled.push(m.actionType),
  );
  const signalling = new SignallingClient(
    'session-1',
    {
      url: { baseUrl: 'engine.test' },
      maxWsReconnectionAttempts,
      heartbeatIntervalSeconds,
    },
    publicEmitter,
    internalEmitter,
  );
  signalling.connect();
  currentSocket().open();
  await flushPromises();
  const registry = new TalkMessageStreamRegistry(internalEmitter);
  const stream = new TalkMessageStream('corr-1', signalling);
  registry.register(stream);
  return { signalling, stream, log, signalled, publicEmitter, registry };
}

const heartbeatSeqs = (socket = currentSocket()) =>
  socket.sent
    .filter((m) => m.actionType === 'heartbeat')
    .map((m) => m.payload.seq);

// Answers like the engine: echoes the seq of the latest heartbeat by default.
function answer(seq = heartbeatSeqs().at(-1)) {
  currentSocket().receive({
    actionType: 'heartbeat',
    sessionId: 'session-1',
    payload: { seq },
  });
}

function sessionReady(payload) {
  currentSocket().receive({
    actionType: 'sessionready',
    sessionId: 'session-1',
    payload,
  });
}

async function reopen() {
  currentSocket().open();
  await flushPromises();
}

// Mock timers run a due timer with the clock already at the end of the tick, so a
// zero-delay heartbeat needs its own tick(0) to go out at the right time.

// Sends a chunk and lets the heartbeat that confirms it go out.
async function sendChunk(stream, text, endOfSpeech = false) {
  await stream.streamMessageChunk(text, endOfSpeech);
  mock.timers.tick(HEARTBEAT_PROBE_COALESCE_MS);
}

async function testUnconfirmedChunkFailsStreamAndReplacesSocket() {
  const { stream, log } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('hello', false);
  mock.timers.tick(0);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS - 1);
  assert.deepEqual(log, []);
  mock.timers.tick(1);
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.equal(stream.getState(), TalkMessageStreamState.DELIVERY_FAILED);
  await assert.rejects(() => stream.streamMessageChunk('more', false));
  assert.equal(FakeWebSocket.instances.length, 2);
  await reopen();
  // Never resent.
  assert.deepEqual(talkSent(currentSocket()), []);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.equal(FakeWebSocket.instances.length, 2);
}

async function testAnsweredHeartbeatConfirmsChunks() {
  const { stream, log, signalled } = await connectedSignalling();
  await stream.streamMessageChunk('a', false);
  await stream.streamMessageChunk('b', false);
  await stream.streamMessageChunk('c', true);
  mock.timers.tick(0);
  // One heartbeat covers the burst.
  assert.deepEqual(heartbeatSeqs(), [0]);
  answer();
  // Answers are consumed, not emitted.
  assert.deepEqual(signalled, []);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(log, []);
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(stream.getState(), TalkMessageStreamState.ENDED);
}

async function testChunkNeedsAHeartbeatSentAfterIt() {
  const { stream, log } = await connectedSignalling();
  await sendChunk(stream, 'a');
  await sendChunk(stream, 'b');
  assert.deepEqual(heartbeatSeqs(), [0, 1]);
  // Heartbeat 0 went out before chunk b, so its answer does not confirm b.
  answer(0);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS);
  assert.deepEqual(log, [['failed', 'corr-1']]);
}

async function testOldAnswerOnNewSocketConfirmsNothing() {
  const { signalling, stream, log, registry } = await connectedSignalling();
  await sendChunk(stream, 'a', true);
  answer();
  currentSocket().drop();
  await flushPromises();
  mock.timers.tick(100);
  await reopen();
  const next = new TalkMessageStream('corr-2', signalling);
  registry.register(next);
  await sendChunk(next, 'b', true);
  // A late answer to heartbeat 0 arriving on the new socket proves nothing about b.
  answer(0);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS);
  assert.deepEqual(log, [['failed', 'corr-2']]);
}

async function testChunkWhileReconnectingFailsImmediately() {
  const { signalling, stream, log } = await connectedSignalling();
  currentSocket().drop();
  await flushPromises();
  await stream.streamMessageChunk('queued', false);
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.equal(stream.getState(), TalkMessageStreamState.DELIVERY_FAILED);
  mock.timers.tick(100);
  await reopen();
  assert.deepEqual(talkSent(currentSocket()), []);
  assert.deepEqual(signalling.sendingBuffer, []);
}

async function testSocketCloseFailsUnconfirmedChunksAtOnce() {
  const { stream, log } = await connectedSignalling();
  await sendChunk(stream, 'sent');
  currentSocket().drop();
  await flushPromises();
  assert.deepEqual(log, [['failed', 'corr-1']]);
  mock.timers.tick(100);
  await reopen();
  // The old socket's heartbeat must not time out and replace the new, healthy socket.
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.deepEqual(talkSent(currentSocket()), []);
}

async function testOverdueHeartbeatFailsChunkWithoutWritingIt() {
  const { stream, log } = await connectedSignalling();
  sessionReady({ sendsHeartbeatAcks: true });
  await sendChunk(stream, 'a');
  mock.timers.tick(HEARTBEAT_SUSPECT_MS);
  // The socket has not answered for 1.5s: the next chunk fails instead of going out.
  await stream.streamMessageChunk('b', false);
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => p.content),
    ['a'],
  );
}

async function testOverdueHeartbeatDoesNotGuardBeforeSessionReady() {
  const { signalling, stream, log, registry } = await connectedSignalling();
  await sendChunk(stream, 'a', true);
  mock.timers.tick(HEARTBEAT_SUSPECT_MS);
  // An older engine may not answer at all, so without sessionready the chunk still goes out.
  const next = new TalkMessageStream('corr-2', signalling);
  registry.register(next);
  await next.streamMessageChunk('b', true);
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => p.content),
    ['a', 'b'],
  );
  assert.deepEqual(log, []);
}

async function testIdleUnansweredHeartbeatReplacesSocket() {
  const { log } = await connectedSignalling({ heartbeatIntervalSeconds: 1 });
  sessionReady({ sendsHeartbeatAcks: true });
  currentSocket().swallow = true;
  mock.timers.tick(1000);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS - 1);
  assert.equal(FakeWebSocket.instances.length, 1);
  mock.timers.tick(1);
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.deepEqual(log, []);
}

async function testIdleAnsweredHeartbeatsKeepSocket() {
  await connectedSignalling({ heartbeatIntervalSeconds: 1 });
  sessionReady({ sendsHeartbeatAcks: true });
  for (let beat = 0; beat < 5; beat += 1) {
    mock.timers.tick(1000);
    answer();
  }
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS - 1);
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.deepEqual(heartbeatSeqs(), [0, 1, 2, 3, 4, 5, 6]);
}

async function testIdleUnansweredHeartbeatBeforeSessionReadyIsIgnored() {
  await connectedSignalling({ heartbeatIntervalSeconds: 1 });
  mock.timers.tick(1000 + HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.equal(FakeWebSocket.instances.length, 1);
}

async function testNewStreamWorksAfterFailure() {
  const { signalling, stream, log, registry } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('lost', false);
  mock.timers.tick(0);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS);
  await reopen();
  const next = new TalkMessageStream('corr-2', signalling);
  registry.register(next);
  await sendChunk(next, 'fresh', true);
  answer();
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(
    talkSent(currentSocket()).map((p) => [p.correlationId, p.content]),
    [['corr-2', 'fresh']],
  );
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.equal(next.getState(), TalkMessageStreamState.ENDED);
}

async function testInterruptionDropsTrackedChunksSilently() {
  const { stream, log } = await connectedSignalling();
  await stream.streamMessageChunk('a', true);
  currentSocket().receive({
    actionType: 'talkinputstreaminterrupted',
    sessionId: 'session-1',
    payload: { correlationId: 'corr-1' },
  });
  await flushPromises();
  assert.equal(stream.getState(), TalkMessageStreamState.INTERRUPTED);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(log, []);
}

async function testEngineWithoutHeartbeatAcksStopsTracking() {
  const { stream, log, signalled } = await connectedSignalling({
    heartbeatIntervalSeconds: 1,
  });
  currentSocket().swallow = true;
  await stream.streamMessageChunk('before', false);
  // An older engine's sessionready has no flag.
  sessionReady({});
  assert.deepEqual(signalled, ['sessionready']);
  await stream.streamMessageChunk('after', true);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 4);
  assert.deepEqual(log, []);
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(stream.getState(), TalkMessageStreamState.ENDED);
}

async function testEngineWithHeartbeatAcksKeepsTracking() {
  const { stream, log } = await connectedSignalling();
  sessionReady({ sendsHeartbeatAcks: true });
  currentSocket().swallow = true;
  await stream.streamMessageChunk('tracked', false);
  mock.timers.tick(0);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS);
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.equal(FakeWebSocket.instances.length, 2);
}

async function testOldEngineHeartbeatIsStillEmitted() {
  const { signalled } = await connectedSignalling();
  // Engine-initiated heartbeats carry no seq and are passed on as before.
  currentSocket().receive({
    actionType: 'heartbeat',
    sessionId: 'session-1',
    payload: {},
  });
  assert.deepEqual(signalled, ['heartbeat']);
}

async function testStopIsSilent() {
  const { signalling, stream, log } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('pending', false);
  signalling.stop();
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
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

async function testIceRestartReconnectFailsUnconfirmedChunks() {
  const { signalling, stream, log } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('hello', false);
  mock.timers.tick(0);
  signalling.reconnectForIceRestart();
  assert.deepEqual(log, [['failed', 'corr-1']]);
  assert.equal(FakeWebSocket.instances.length, 2);
  await reopen();
  assert.deepEqual(talkSent(currentSocket()), []);
}

async function testChunkAfterStopIsSilent() {
  const { signalling, stream, log } = await connectedSignalling();
  signalling.stop();
  await stream.streamMessageChunk('late', false);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS * 2);
  assert.deepEqual(log, []);
  assert.equal(stream.getState(), TalkMessageStreamState.STREAMING);
  assert.deepEqual(signalling.sendingBuffer, []);
}

async function testChunkAfterTerminalCloseFails() {
  const { signalling, stream, log } = await connectedSignalling({
    maxWsReconnectionAttempts: 1,
  });
  currentSocket().drop();
  await flushPromises();
  mock.timers.tick(100);
  currentSocket().drop();
  await flushPromises();
  await stream.streamMessageChunk('late', false);
  assert.deepEqual(
    log.map(([kind]) => kind),
    ['closed', 'failed'],
  );
  assert.equal(stream.getState(), TalkMessageStreamState.DELIVERY_FAILED);
  assert.deepEqual(signalling.sendingBuffer, []);
}

async function testThrowingFailureListenerDoesNotBlockConnectionClosed() {
  const { signalling, stream, log, publicEmitter } = await connectedSignalling({
    maxWsReconnectionAttempts: 1,
  });
  publicEmitter.addListener(AnamEvent.MESSAGE_DELIVERY_FAILED, () => {
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

async function testHeartbeatReplaceGetsExtendedRetryBudgetUntilStable() {
  const { signalling, stream, log } = await connectedSignalling();
  currentSocket().swallow = true;
  await stream.streamMessageChunk('hello', false);
  mock.timers.tick(0);
  mock.timers.tick(HEARTBEAT_ACK_TIMEOUT_MS);
  // The default budget (5) would give up on the 6th close; a network switch needs
  // the same headroom an ICE-restart reconnect gets.
  await dropRepeatedly(6);
  assert.equal(signalling.isPermanentlyClosed(), false);
  await reopen();
  // Once the replacement has been stable, the default budget applies again.
  mock.timers.tick(5000);
  await dropRepeatedly(6);
  assert.equal(signalling.isPermanentlyClosed(), true);
  assert.deepEqual(
    log.map(([kind]) => kind),
    ['failed', 'closed'],
  );
}

async function testStopReportsHeartbeatStats() {
  const requests = [];
  const previousFetch = global.fetch;
  const previousRandom = Math.random;
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
  };
  // Put this session in the sample, so a healthy window is reported.
  Math.random = () => 0;
  try {
    const { signalling, stream } = await connectedSignalling();
    await stream.streamMessageChunk('a', true);
    mock.timers.tick(0);
    mock.timers.tick(25);
    answer();
    signalling.stop();
    await flushPromises();
    const heartbeat = requests.filter((m) => m.name === 'client_heartbeat');
    assert.equal(heartbeat.length, 1);
    assert.equal(heartbeat[0].fields.answers, 1);
    assert.equal(heartbeat[0].fields.p50Ms, 25);
  } finally {
    global.fetch = previousFetch;
    Math.random = previousRandom;
  }
}

const signallingTests = [
  testStopReportsHeartbeatStats,
  testUnconfirmedChunkFailsStreamAndReplacesSocket,
  testAnsweredHeartbeatConfirmsChunks,
  testChunkNeedsAHeartbeatSentAfterIt,
  testOldAnswerOnNewSocketConfirmsNothing,
  testChunkWhileReconnectingFailsImmediately,
  testSocketCloseFailsUnconfirmedChunksAtOnce,
  testOverdueHeartbeatFailsChunkWithoutWritingIt,
  testOverdueHeartbeatDoesNotGuardBeforeSessionReady,
  testIdleUnansweredHeartbeatReplacesSocket,
  testIdleAnsweredHeartbeatsKeepSocket,
  testIdleUnansweredHeartbeatBeforeSessionReadyIsIgnored,
  testNewStreamWorksAfterFailure,
  testInterruptionDropsTrackedChunksSilently,
  testEngineWithoutHeartbeatAcksStopsTracking,
  testEngineWithHeartbeatAcksKeepsTracking,
  testOldEngineHeartbeatIsStillEmitted,
  testStopIsSilent,
  testTerminalCloseFailsPendingBeforeConnectionClosed,
  testIceRestartReconnectFailsUnconfirmedChunks,
  testChunkAfterStopIsSilent,
  testChunkAfterTerminalCloseFails,
  testThrowingFailureListenerDoesNotBlockConnectionClosed,
  testHeartbeatReplaceGetsExtendedRetryBudgetUntilStable,
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
