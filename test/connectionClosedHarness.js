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

globalThis.WebSocket ??= { OPEN: 1 };

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
  const milestones = [];
  const connectionMilestones = {
    record(name, tags) {
      milestones.push([name, tags]);
    },
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
  return { client, pc, closed, failures, milestones };
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
  for (const reasonCode of ['MAX_SESSION_LENGTH', undefined]) {
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
      payloadFormat: 'unencoded',
      reasonCode: 'webrtc_dtls_failed',
    }),
  });
  await flushPromises();
  assert.deepEqual(closed, [[ConnectionClosedCode.WEBRTC_FAILURE, 'txt']]);
  assert.deepEqual(failures, [
    { failureStage: 'webrtc', reasonCode: 'webrtc_dtls_failed' },
  ]);
}

async function testSignallingReconnectDuringStatsReport() {
  let peerConnectionsCreated = 0;
  global.RTCPeerConnection = function RTCPeerConnection() {
    peerConnectionsCreated += 1;
    throw new Error('unexpected peer connection');
  };
  try {
    const { client, pc, closed } = createClient({
      showPeerConnectionStatsReport: true,
    });
    const socket = {
      readyState: WebSocket.OPEN,
      send() {},
      close() {},
    };
    client.signallingClient.socket = socket;
    const pending = endSession(client, 'webrtc_dtls_failed');
    await client.signallingClient.onOpen(socket);
    pc.resolveStats();
    await pending;
    await flushPromises();
    assert.equal(peerConnectionsCreated, 0);
    assert.deepEqual(closed, [[ConnectionClosedCode.WEBRTC_FAILURE, 'txt']]);
  } finally {
    delete global.RTCPeerConnection;
  }
}

async function testEndSessionRecordsReasonCode() {
  const { client, milestones } = createClient();
  await endSession(client, 'webrtc_connection_lost');
  assert.deepEqual(
    milestones.filter(([name]) => name === 'server_end_session'),
    [['server_end_session', { reasonCode: 'webrtc_connection_lost' }]],
  );

  const late = createClient();
  late.client.connectionClosedEmitted = true;
  await endSession(late.client, 'MAX_SESSION_LENGTH');
  assert.deepEqual(
    late.milestones.filter(([name]) => name === 'server_end_session'),
    [['server_end_session', { reasonCode: 'MAX_SESSION_LENGTH' }]],
  );
  assert.deepEqual(late.closed, []);
}

async function testRejectedStatsStillReleasesResources() {
  const { client, pc } = createClient({ showPeerConnectionStatsReport: true });
  let closeCalls = 0;
  const close = pc.close;
  pc.close = () => {
    closeCalls += 1;
    close();
  };
  pc.getStats = () => Promise.reject(new Error('stats unavailable'));
  const track = {
    stopped: false,
    stop() {
      track.stopped = true;
    },
  };
  client.inputAudioStream = { getTracks: () => [track] };
  client.statsCollectionInterval = setInterval(() => {}, 60_000);
  client.successMetricPoller = setInterval(() => {}, 60_000);
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    await client.shutdown().catch(() => {});
    await client.shutdown().catch(() => {});
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  clearInterval(client.statsCollectionInterval);
  clearInterval(client.successMetricPoller);
  assert.equal(closeCalls, 1);
  assert.equal(track.stopped, true);
  assert.equal(client.inputAudioStream, null);
  assert.equal(client.statsCollectionInterval, null);
  assert.equal(client.successMetricPoller, null);
  assert.equal(client.peerConnection, null);
}

async function testSignallingExhaustedDuringInitialAnswer() {
  const { client, pc, closed } = createClient({ connectionState: 'new' });
  pc.signalingState = 'have-local-offer';
  let rejectAnswer;
  pc.setRemoteDescription = () =>
    new Promise((_, reject) => {
      rejectAnswer = reject;
    });
  const pending = client.onSignalMessage({
    actionType: SignalMessageAction.ANSWER,
    sessionId: 'session-1',
    payload: { type: 'answer', sdp: '' },
  });
  const signalling = client.signallingClient;
  const socket = { readyState: 3, close() {} };
  signalling.socket = socket;
  signalling.wsConnectionAttempts = 1000;
  const originalError = console.error;
  console.error = () => {};
  try {
    await signalling.onClose(socket, {
      code: 1006,
      reason: '',
      wasClean: false,
    });
    rejectAnswer(new Error('signalling closed'));
    await pending;
    await flushPromises();
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(closed, [
    [ConnectionClosedCode.SIGNALLING_CLIENT_CONNECTION_FAILURE],
  ]);
  assert.equal(pc.connectionState, 'closed');
}

async function main() {
  setClientMetricsDisabled(true);
  await testMediaReasonCodesReportWebrtcFailure();
  await testOtherReasonCodesReportServerClosed();
  await testEndSessionThenPeerConnectionClosed();
  await testPeerConnectionClosedThenEndSession();
  await testEndSessionThenInFlightWebrtcFailure();
  await testEngineEndSessionFrame();
  await testSignallingReconnectDuringStatsReport();
  await testEndSessionRecordsReasonCode();
  await testRejectedStatsStillReleasesResources();
  await testSignallingExhaustedDuringInitialAnswer();
  console.log('connection closed harness passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
