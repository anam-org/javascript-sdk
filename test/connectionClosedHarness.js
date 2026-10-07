const assert = require('node:assert/strict');
const { StreamingClient } = require('../dist/main/modules/StreamingClient');
const {
  PublicEventEmitter,
} = require('../dist/main/modules/PublicEventEmitter');
const {
  InternalEventEmitter,
} = require('../dist/main/modules/InternalEventEmitter');
const { setClientMetricsDisabled } = require('../dist/main/lib/ClientMetrics');
const { AnamEvent, ConnectionClosedCode } = require('../dist/main/types');
const { SignalMessageAction } = require('../dist/main/types');

const MEDIA_REASON_CODES = [
  'user_never_established_webrtc_connection',
  'webrtc_dtls_failed',
  'webrtc_connection_lost',
];

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function createFakePeerConnection({ connectionState = 'connected' } = {}) {
  const pc = {
    connectionState,
    iceConnectionState: connectionState === 'closed' ? 'closed' : 'connected',
    onconnectionstatechange: null,
    oniceconnectionstatechange: null,
    onicecandidate: null,
    resolveStats: null,
    getStats() {
      return new Promise((resolve) => {
        pc.resolveStats = () => resolve(new Map());
      });
    },
    close() {
      pc.connectionState = 'closed';
      pc.iceConnectionState = 'closed';
    },
  };
  return pc;
}

function createClient({
  showPeerConnectionStatsReport = false,
  connectionState,
} = {}) {
  const publicEventEmitter = new PublicEventEmitter();
  const closed = [];
  publicEventEmitter.addListener(AnamEvent.CONNECTION_CLOSED, (...args) => {
    closed.push(args);
  });
  const failures = [];
  const connectionMilestones = {
    record() {},
    publishFailure(tags) {
      failures.push(tags);
    },
  };
  const client = new StreamingClient(
    'session-1',
    {
      inputAudio: {
        inputAudioState: { isMuted: false, permissionState: 'not_requested' },
        disableInputAudio: true,
      },
      signalling: { url: { baseUrl: 'engine.test' } },
      engine: { baseUrl: 'https://engine.test' },
      iceServers: [],
      metrics: {
        showPeerConnectionStatsReport,
        peerConnectionStatsReportOutputFormat: 'json',
      },
    },
    publicEventEmitter,
    new InternalEventEmitter(),
    {
      processToolCallStartedEvent() {},
      processToolCallCompletedEvent() {},
      processToolCallFailedEvent() {},
    },
    connectionMilestones,
  );
  const pc = createFakePeerConnection({ connectionState });
  client.peerConnection = pc;
  pc.onconnectionstatechange = client.onConnectionStateChange.bind(client);
  return { client, pc, closed, failures };
}

function endSession(client, reasonCode) {
  return client.onSignalMessage({
    actionType: SignalMessageAction.END_SESSION,
    sessionId: 'session-1',
    payload: 'txt',
    ...(reasonCode ? { reasonCode } : {}),
  });
}

function firePeerConnectionClosed(pc) {
  pc.connectionState = 'closed';
  pc.onconnectionstatechange?.();
}

async function testMediaReasonCodesReportWebrtcFailure() {
  for (const reasonCode of MEDIA_REASON_CODES) {
    const { client, closed, failures } = createClient();
    await endSession(client, reasonCode);
    await flushPromises();
    assert.deepEqual(
      closed,
      [[ConnectionClosedCode.WEBRTC_FAILURE, 'txt']],
      reasonCode,
    );
    assert.deepEqual(failures, [{ failureStage: 'webrtc', reasonCode }]);
  }
}

async function testOtherReasonCodesReportServerClosed() {
  for (const reasonCode of ['max_session_length_reached', undefined]) {
    const { client, closed, failures } = createClient();
    await endSession(client, reasonCode);
    await flushPromises();
    assert.deepEqual(
      closed,
      [[ConnectionClosedCode.SERVER_CLOSED_CONNECTION, 'txt']],
      String(reasonCode),
    );
    assert.deepEqual(failures, [{ failureStage: 'server_closed_connection' }]);
  }
}

const variants = [
  { name: 'default' },
  { name: 'stats report', showPeerConnectionStatsReport: true },
  { name: 'already closed pc', connectionState: 'closed' },
  {
    name: 'stats report, already closed pc',
    showPeerConnectionStatsReport: true,
    connectionState: 'closed',
  },
];

async function testEndSessionThenPeerConnectionClosed() {
  for (const variant of variants) {
    const { client, pc, closed } = createClient(variant);
    const pending = endSession(client, 'webrtc_dtls_failed');
    firePeerConnectionClosed(pc);
    pc.resolveStats?.();
    await pending;
    await flushPromises();
    assert.deepEqual(
      closed,
      [[ConnectionClosedCode.WEBRTC_FAILURE, 'txt']],
      variant.name,
    );
    assert.equal(client.peerConnection, null, variant.name);
  }
}

async function testPeerConnectionClosedThenEndSession() {
  for (const variant of variants) {
    const { client, pc, closed } = createClient(variant);
    firePeerConnectionClosed(pc);
    await endSession(client, 'webrtc_connection_lost');
    pc.resolveStats?.();
    await flushPromises();
    assert.deepEqual(
      closed,
      [[ConnectionClosedCode.WEBRTC_FAILURE]],
      variant.name,
    );
    assert.equal(client.peerConnection, null, variant.name);
  }
}

async function testEndSessionThenInFlightWebrtcFailure() {
  const { client, closed } = createClient();
  await endSession(client, 'webrtc_dtls_failed');
  client.handleWebrtcFailure(new Error('setRemoteDescription failed'));
  await flushPromises();
  assert.deepEqual(closed, [[ConnectionClosedCode.WEBRTC_FAILURE, 'txt']]);
}

async function testEngineEndSessionFrame() {
  const { client, closed, failures } = createClient();
  await client.signallingClient.onMessage({
    data: JSON.stringify({
      sessionId: 'session-1',
      actionType: 'endsession',
      payload: 'txt',
      payloadFormat: 'text',
      reasonCode: 'webrtc_dtls_failed',
    }),
  });
  await flushPromises();
  assert.deepEqual(closed, [[ConnectionClosedCode.WEBRTC_FAILURE, 'txt']]);
  assert.deepEqual(failures, [
    { failureStage: 'webrtc', reasonCode: 'webrtc_dtls_failed' },
  ]);
}

async function main() {
  setClientMetricsDisabled(true);
  await testMediaReasonCodesReportWebrtcFailure();
  await testOtherReasonCodesReportServerClosed();
  await testEndSessionThenPeerConnectionClosed();
  await testPeerConnectionClosedThenEndSession();
  await testEndSessionThenInFlightWebrtcFailure();
  await testEngineEndSessionFrame();
  console.log('connection closed harness passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
