const assert = require('node:assert/strict');
const { StreamingClient } = require('../dist/main/modules/StreamingClient');
const {
  PublicEventEmitter,
} = require('../dist/main/modules/PublicEventEmitter');
const {
  InternalEventEmitter,
} = require('../dist/main/modules/InternalEventEmitter');
const { setClientMetricsDisabled } = require('../dist/main/lib/ClientMetrics');
const {
  AnamEvent,
  InternalEvent,
  SignalMessageAction,
} = require('../dist/main/types');

globalThis.WebSocket ??= { OPEN: 1 };

const fakePeerConnection = () => ({
  connectionState: 'connected',
  iceConnectionState: 'connected',
  close() {},
});

// AnamClient passes the same public and internal emitters to every
// StreamingClient it builds, so tests that share them mirror real back-to-back
// sessions.
function createEmitters() {
  const publicEventEmitter = new PublicEventEmitter();
  const ready = [];
  publicEventEmitter.addListener(AnamEvent.SESSION_READY, (id) => {
    ready.push(id);
  });
  return {
    publicEventEmitter,
    internalEventEmitter: new InternalEventEmitter(),
    ready,
  };
}

function createClient(sessionId, emitters = createEmitters()) {
  const client = new StreamingClient(
    sessionId,
    {
      inputAudio: {
        inputAudioState: { isMuted: false, permissionState: 'not_requested' },
        disableInputAudio: true,
      },
      signalling: { url: { baseUrl: 'engine.test' } },
      engine: { baseUrl: 'https://engine.test' },
      iceServers: [],
    },
    emitters.publicEventEmitter,
    emitters.internalEventEmitter,
    {
      processToolCallStartedEvent() {},
      processToolCallCompletedEvent() {},
      processToolCallFailedEvent() {},
    },
  );
  // Signal messages are handled once the peer connection exists.
  client.peerConnection = fakePeerConnection();
  return { client, ready: emitters.ready };
}

const sessionReady = (sessionId) => ({
  actionType: SignalMessageAction.SESSION_READY,
  sessionId,
  payload: { sendsHeartbeatAcks: true },
});

async function testSessionReadyIsEmittedOnce() {
  // A server re-sends SESSION_READY after the signalling socket reconnects,
  // in case the first copy was lost. Apps must see it once.
  const { client, ready } = createClient('session-1');
  await client.onSignalMessage(sessionReady('session-1'));
  await client.onSignalMessage(sessionReady('session-1'));
  assert.deepEqual(ready, ['session-1']);
}

async function testEachSessionGetsItsOwnSessionReady() {
  const first = createClient('session-1');
  const second = createClient('session-2');
  await first.client.onSignalMessage(sessionReady('session-1'));
  await second.client.onSignalMessage(sessionReady('session-2'));
  assert.deepEqual(first.ready, ['session-1']);
  assert.deepEqual(second.ready, ['session-2']);
}

async function testEarlyCopyDoesNotUseUpTheSlot() {
  // A copy that arrives before the peer connection exists is dropped, and the
  // copy the server re-sends later must still reach the app.
  const { client, ready } = createClient('session-1');
  client.peerConnection = null;
  await client.onSignalMessage(sessionReady('session-1'));
  client.peerConnection = fakePeerConnection();
  await client.onSignalMessage(sessionReady('session-1'));
  assert.deepEqual(ready, ['session-1']);
}

const deliver = async (emitters, message) => {
  // The signalling client delivers messages through the shared emitter, which
  // calls every StreamingClient's async handler.
  emitters.internalEventEmitter.emit(
    InternalEvent.SIGNAL_MESSAGE_RECEIVED,
    message,
  );
  await new Promise((resolve) => setImmediate(resolve));
};

async function testStoppedClientIgnoresNextSessionBeforeItsOwnReady() {
  // Session 1 stops before its SESSION_READY arrives, and session 2 starts on
  // the same AnamClient. The stopped client keeps its listeners and builds a
  // new peer connection when session 2's socket opens, so it sees session 2's
  // messages. Session 2 must still be reported once.
  const emitters = createEmitters();
  const first = createClient('session-1', emitters);
  first.client.peerConnection = null; // stopped
  createClient('session-2', emitters);
  first.client.peerConnection = fakePeerConnection(); // rebuilt on socket open
  await deliver(emitters, sessionReady('session-2'));
  await deliver(emitters, sessionReady('session-2')); // re-sent after reconnect
  assert.deepEqual(emitters.ready, ['session-2']);
}

async function testBackToBackSessionsOnSharedEmitters() {
  const emitters = createEmitters();
  const first = createClient('session-1', emitters);
  await deliver(emitters, sessionReady('session-1'));
  first.client.peerConnection = null; // stopped
  createClient('session-2', emitters);
  first.client.peerConnection = fakePeerConnection(); // rebuilt on socket open
  await deliver(emitters, sessionReady('session-2'));
  await deliver(emitters, sessionReady('session-2')); // re-sent after reconnect
  assert.deepEqual(emitters.ready, ['session-1', 'session-2']);
}

(async () => {
  setClientMetricsDisabled(true);
  await testSessionReadyIsEmittedOnce();
  await testEachSessionGetsItsOwnSessionReady();
  await testEarlyCopyDoesNotUseUpTheSlot();
  await testStoppedClientIgnoresNextSessionBeforeItsOwnReady();
  await testBackToBackSessionsOnSharedEmitters();
  console.log('session ready harness passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
