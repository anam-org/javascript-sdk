const assert = require('node:assert/strict');
const { StreamingClient } = require('../dist/main/modules/StreamingClient');
const {
  PublicEventEmitter,
} = require('../dist/main/modules/PublicEventEmitter');
const {
  InternalEventEmitter,
} = require('../dist/main/modules/InternalEventEmitter');
const { setClientMetricsDisabled } = require('../dist/main/lib/ClientMetrics');
const { AnamEvent, SignalMessageAction } = require('../dist/main/types');

globalThis.WebSocket ??= { OPEN: 1 };

function createClient(sessionId) {
  const publicEventEmitter = new PublicEventEmitter();
  const ready = [];
  publicEventEmitter.addListener(AnamEvent.SESSION_READY, (id) => {
    ready.push(id);
  });
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
    publicEventEmitter,
    new InternalEventEmitter(),
    {
      processToolCallStartedEvent() {},
      processToolCallCompletedEvent() {},
      processToolCallFailedEvent() {},
    },
  );
  // Signal messages are handled once the peer connection exists.
  client.peerConnection = {
    connectionState: 'connected',
    iceConnectionState: 'connected',
    close() {},
  };
  return { client, ready };
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

(async () => {
  setClientMetricsDisabled(true);
  await testSessionReadyIsEmittedOnce();
  await testEachSessionGetsItsOwnSessionReady();
  console.log('session ready harness passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
