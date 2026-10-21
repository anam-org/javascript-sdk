const assert = require('node:assert/strict');
const {
  orderCodecsByPreference,
  resolveVisionSources,
  isScreenCaptureSupported,
  scaleDownFactor,
  SCREEN_CODEC_PREFERENCE,
  CAMERA_CODEC_PREFERENCE,
} = require('../dist/main/lib/visualInput');
const {
  VisualInputManager,
} = require('../dist/main/modules/VisualInputManager');

const codec = (mimeType, sdpFmtpLine) => ({
  mimeType,
  clockRate: 90000,
  sdpFmtpLine,
});

function testScreenPrefersAv1ThenFallbacks() {
  const codecs = [
    codec('video/VP8'),
    codec('video/rtx'),
    codec('video/H264', 'profile-level-id=42e01f'),
    codec('video/VP9'),
    codec('video/AV1'),
    codec('video/red'),
  ];
  const ordered = orderCodecsByPreference(codecs, SCREEN_CODEC_PREFERENCE).map(
    (c) => c.mimeType,
  );
  assert.deepEqual(ordered, [
    'video/AV1',
    'video/VP9',
    'video/H264',
    'video/VP8',
    'video/rtx',
    'video/red',
  ]);
}

function testSkipsCodecsTheBrowserCannotEncode() {
  // A browser that decodes AV1 but has no AV1 encoder must fall back to VP9.
  const codecs = [codec('video/AV1'), codec('video/VP9'), codec('video/VP8')];
  const encodable = new Set(['video/vp9', 'video/vp8']);
  const ordered = orderCodecsByPreference(
    codecs,
    SCREEN_CODEC_PREFERENCE,
    encodable,
  ).map((c) => c.mimeType);
  assert.equal(ordered[0], 'video/VP9');
  assert.ok(
    ordered.includes('video/AV1'),
    'AV1 stays in the list for decoding',
  );
}

function testCameraPrefersH264AndKeepsAllProfiles() {
  const codecs = [
    codec('video/VP8'),
    codec('video/h264', 'profile-level-id=42e01f'),
    codec('video/H264', 'profile-level-id=640c1f'),
  ];
  const ordered = orderCodecsByPreference(codecs, CAMERA_CODEC_PREFERENCE);
  assert.equal(ordered.length, 3);
  assert.equal(ordered[0].sdpFmtpLine, 'profile-level-id=42e01f');
  assert.equal(ordered[1].sdpFmtpLine, 'profile-level-id=640c1f');
  assert.equal(ordered[2].mimeType, 'video/VP8');
}

function testResolveSourcesDropsScreenWithoutDisplayMedia() {
  assert.deepEqual(resolveVisionSources(undefined, true), ['camera', 'screen']);
  assert.deepEqual(resolveVisionSources(undefined, false), ['camera']);
  assert.deepEqual(resolveVisionSources(['screen'], false), []);
  // Order is canonical, not caller order, so MIDs are allocated predictably.
  assert.deepEqual(resolveVisionSources(['screen', 'camera'], true), [
    'camera',
    'screen',
  ]);
}

function testScreenCaptureDetection() {
  assert.equal(isScreenCaptureSupported(undefined), false);
  assert.equal(isScreenCaptureSupported({}), false);
  assert.equal(isScreenCaptureSupported({ getDisplayMedia() {} }), true);
}

function testScaleDownFactor() {
  assert.equal(scaleDownFactor(640, 480, 640), 1);
  assert.equal(scaleDownFactor(320, 240, 640), 1, 'never upscales');
  assert.equal(scaleDownFactor(3840, 2160, 1920), 2);
  assert.equal(scaleDownFactor(1080, 1920, 1920), 1, 'portrait uses long edge');
  assert.equal(scaleDownFactor(undefined, undefined, 640), 1);
}

// ---------------------------------------------------------------------------
// VisualInputManager with fake WebRTC objects
// ---------------------------------------------------------------------------

function fakeTrack(settings = { width: 1280, height: 720, frameRate: 30 }) {
  const listeners = {};
  return {
    kind: 'video',
    contentHint: '',
    stopped: false,
    stop() {
      this.stopped = true;
    },
    getSettings: () => settings,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    removeEventListener(type, fn) {
      if (listeners[type] === fn) delete listeners[type];
    },
    fire(type) {
      listeners[type]?.();
    },
  };
}

function fakeStream(track) {
  return { getVideoTracks: () => (track ? [track] : []) };
}

function fakePeerConnection() {
  const transceivers = [];
  return {
    transceivers,
    addTransceiver(kind, init) {
      const sender = {
        track: null,
        parameters: { encodings: init.sendEncodings.map((e) => ({ ...e })) },
        async replaceTrack(track) {
          this.track = track;
        },
        getParameters() {
          return JSON.parse(JSON.stringify(this.parameters));
        },
        async setParameters(parameters) {
          this.parameters = parameters;
        },
      };
      const transceiver = { kind, init, sender, mid: null };
      transceivers.push(transceiver);
      return transceiver;
    },
  };
}

function setup(options = { sources: ['camera', 'screen'] }) {
  const emitted = [];
  const sent = [];
  let dataChannelOpen = true;
  const manager = new VisualInputManager(
    options,
    { emit: (event, payload) => emitted.push({ event, payload }) },
    (message) => {
      if (!dataChannelOpen) return false;
      sent.push(JSON.parse(message));
      return true;
    },
    () => 'session-1',
  );
  const pc = fakePeerConnection();
  manager.attach(pc);
  return {
    manager,
    pc,
    emitted,
    sent,
    closeDataChannel: () => {
      dataChannelOpen = false;
    },
  };
}

// Node has no navigator.mediaDevices; screen support follows getDisplayMedia.
// Node 21+ defines a read-only navigator, so redefine the property.
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { getDisplayMedia() {} } },
  configurable: true,
});

function testAttachAddsSendOnlyTransceiversPerSource() {
  const { pc, manager } = setup();
  assert.equal(pc.transceivers.length, 2);
  for (const t of pc.transceivers) {
    assert.equal(t.kind, 'video');
    assert.equal(t.init.direction, 'sendonly');
  }
  assert.deepEqual(
    manager.getTrackMappings(),
    [],
    'no MIDs before local description',
  );
  pc.transceivers[0].mid = '3';
  pc.transceivers[1].mid = '4';
  assert.deepEqual(manager.getTrackMappings(), [
    { source: 'camera', mid: '3' },
    { source: 'screen', mid: '4' },
  ]);
}

async function testStartCameraWithProvidedStream() {
  const { manager, pc, emitted, sent } = setup();
  const track = fakeTrack();
  await manager.startCamera({ stream: fakeStream(track) });

  const sender = pc.transceivers[0].sender;
  assert.equal(sender.track, track);
  assert.equal(track.contentHint, 'motion');
  assert.equal(sender.parameters.encodings[0].maxFramerate, 10);
  assert.equal(sender.parameters.encodings[0].scaleResolutionDownBy, 2);
  assert.equal(manager.isSourceActive('camera'), true);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].message_type, 'visual_source_state');
  assert.equal(sent[0].source, 'camera');
  assert.equal(sent[0].state, 'active');
  assert.equal(sent[0].session_id, 'session-1');
  assert.equal(emitted.at(-1).event, 'VISUAL_SOURCE_STARTED');

  // A caller-provided track is not stopped by the SDK.
  await manager.stopSource('camera');
  assert.equal(track.stopped, false);
  assert.equal(sender.track, null);
  assert.equal(sent.at(-1).state, 'inactive');
  assert.equal(sent.at(-1).reason, 'stopped_by_client');
  assert.equal(emitted.at(-1).event, 'VISUAL_SOURCE_STOPPED');
}

async function testScreenTrackEndedFromBrowserChrome() {
  const { manager, pc, emitted, sent } = setup();
  const track = fakeTrack({ width: 2560, height: 1440, frameRate: 5 });
  await manager.startScreenCapture({ stream: fakeStream(track) });
  assert.equal(track.contentHint, 'text');
  const params = pc.transceivers[1].sender.parameters;
  assert.equal(params.degradationPreference, 'maintain-resolution');
  assert.equal(params.encodings[0].scaleResolutionDownBy, 2560 / 1920);

  track.fire('ended');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.isSourceActive('screen'), false);
  assert.equal(pc.transceivers[1].sender.track, null);
  assert.equal(sent.at(-1).reason, 'track_ended');
  assert.equal(emitted.at(-1).payload.reason, 'track_ended');
}

async function testReplacingTrackKeepsTransceiver() {
  const { manager, pc } = setup();
  const first = fakeTrack();
  const second = fakeTrack();
  await manager.startCamera({ stream: fakeStream(first) });
  await manager.startCamera({ stream: fakeStream(second) });
  assert.equal(pc.transceivers.length, 2, 'no new transceiver on replace');
  assert.equal(pc.transceivers[0].sender.track, second);
  // The old track's ended event no longer stops the source.
  first.fire('ended');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.isSourceActive('camera'), true);
}

async function testSourceNotNegotiated() {
  const { manager } = setup({ sources: ['camera'] });
  await assert.rejects(
    manager.startScreenCapture({ stream: fakeStream(fakeTrack()) }),
    (error) => error.code === 'CLIENT_ERROR_CODE_CONFIGURATION_ERROR',
  );
}

async function testStreamWithoutVideoTrack() {
  const { manager, emitted } = setup();
  await assert.rejects(manager.startCamera({ stream: fakeStream(null) }));
  assert.equal(emitted.at(-1).event, 'VISUAL_SOURCE_FAILED');
  assert.equal(emitted.at(-1).payload.stage, 'capture');
}

async function testAnalysisRequestResolvesOnMatchingId() {
  const { manager, sent, emitted } = setup();
  await manager.startCamera({ stream: fakeStream(fakeTrack()) });
  const pending = manager.requestAnalysis({ goal: 'What is on the desk?' });
  const request = sent.at(-1);
  assert.equal(request.message_type, 'vision_analysis_request');
  assert.deepEqual(request.sources, ['camera']);
  assert.equal(request.goal, 'What is on the desk?');

  // A result for another request is ignored by this promise.
  manager.handleDataChannelMessage('visionAnalysisCompleted', {
    request_id: 'other',
    sources: {},
    requested_at_ms: 1,
    completed_at_ms: 2,
  });
  const handled = manager.handleDataChannelMessage('visionAnalysisCompleted', {
    request_id: request.request_id,
    sources: {
      camera: {
        source: 'camera',
        captured_at_ms: 10,
        analyzed_at_ms: 20,
        summary: 'A laptop and a mug.',
      },
    },
    answer: 'A laptop and a mug.',
    requested_at_ms: 5,
    completed_at_ms: 25,
  });
  assert.equal(handled, true);
  const result = await pending;
  assert.equal(result.answer, 'A laptop and a mug.');
  assert.equal(result.sources.camera.summary, 'A laptop and a mug.');
  assert.equal(emitted.at(-1).event, 'VISION_ANALYSIS_COMPLETED');
}

async function testAnalysisRequestRejections() {
  const { manager, sent, closeDataChannel } = setup();
  await assert.rejects(manager.requestAnalysis(), /no visual source is active/);
  await manager.startCamera({ stream: fakeStream(fakeTrack()) });
  await assert.rejects(
    manager.requestAnalysis({ sources: ['screen'] }),
    /source not active: screen/,
  );
  await assert.rejects(
    manager.requestAnalysis({ goal: 'x'.repeat(501) }),
    /must not exceed 500/,
  );

  const failing = manager.requestAnalysis();
  manager.handleDataChannelMessage('visionAnalysisFailed', {
    request_id: sent.at(-1).request_id,
    error: 'provider_unavailable',
  });
  await assert.rejects(failing, /provider_unavailable/);

  await assert.rejects(manager.requestAnalysis({ timeoutMs: 5 }), /timed out/);

  closeDataChannel();
  await assert.rejects(manager.requestAnalysis(), /data channel is not open/);
}

async function testShutdownStopsOwnedTracksAndRejectsPending() {
  const { manager, emitted } = setup();
  await manager.startCamera({ stream: fakeStream(fakeTrack()) });
  const pending = manager.requestAnalysis();
  manager.shutdown();
  await assert.rejects(pending, /session ended/);
  assert.equal(manager.isSourceActive('camera'), false);
  assert.equal(
    emitted.find((e) => e.event === 'VISUAL_SOURCE_STOPPED').payload.reason,
    'connection_closed',
  );
}

function testNonVisionMessagesAreNotHandled() {
  const { manager } = setup();
  assert.equal(manager.handleDataChannelMessage('speechText', {}), false);
}

async function main() {
  testScreenPrefersAv1ThenFallbacks();
  testSkipsCodecsTheBrowserCannotEncode();
  testCameraPrefersH264AndKeepsAllProfiles();
  testResolveSourcesDropsScreenWithoutDisplayMedia();
  testScreenCaptureDetection();
  testScaleDownFactor();
  testAttachAddsSendOnlyTransceiversPerSource();
  await testStartCameraWithProvidedStream();
  await testScreenTrackEndedFromBrowserChrome();
  await testReplacingTrackKeepsTransceiver();
  await testSourceNotNegotiated();
  await testStreamWithoutVideoTrack();
  await testAnalysisRequestResolvesOnMatchingId();
  await testAnalysisRequestRejections();
  await testShutdownStopsOwnedTracksAndRejectsPending();
  testNonVisionMessagesAreNotHandled();
  console.log('visual input harness passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
