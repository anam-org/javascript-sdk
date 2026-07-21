const assert = require('assert');
const {
  buildTransparentBackgroundSessionOptions,
  detectPackedAlphaCapability,
  prepareOfferForTransparentBackgroundTransport,
  promotePackedAlphaH264Level,
} = require('../dist/main/modules/PackedAlphaTransport');
const {
  PACKED_ALPHA_TRANSPORT,
} = require('../dist/main/types/TransparentBackgroundTransport');

void (async () => {
  let decodingConfiguration;
  const supportedMediaCapabilities = {
    decodingInfo: async (configuration) => {
      decodingConfiguration = configuration;
      return { supported: true, smooth: true, powerEfficient: true };
    },
  };

  assert.equal(
    await detectPackedAlphaCapability(supportedMediaCapabilities),
    'supported',
  );
  assert.deepEqual(decodingConfiguration, {
    type: 'webrtc',
    video: {
      contentType:
        'video/H264;level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d0028',
      width: 1152,
      height: 1536,
      bitrate: 2500000,
      framerate: 25,
    },
  });
  assert.deepEqual(
    await buildTransparentBackgroundSessionOptions(
      true,
      supportedMediaCapabilities,
    ),
    {
      transparentBackground: true,
      transparentBackgroundTransport: PACKED_ALPHA_TRANSPORT,
    },
    'supported devices must request packed-alpha-v1',
  );

  const originalWarn = console.warn;
  let warning = '';
  console.warn = (message) => {
    warning = message;
  };
  try {
    assert.deepEqual(
      await buildTransparentBackgroundSessionOptions(true, {
        decodingInfo: async () => ({
          supported: false,
          smooth: false,
          powerEfficient: false,
        }),
      }),
      { transparentBackground: true },
      'an explicit unsupported result must retain the legacy green path',
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.match(warning, /falling back to legacy green-screen keying/);

  assert.equal(
    await detectPackedAlphaCapability({
      decodingInfo: async () => ({
        supported: true,
        smooth: false,
        powerEfficient: false,
      }),
    }),
    'unsupported',
    'a supported decoder that cannot sustain the packed resolution must use the compatibility path',
  );

  assert.deepEqual(
    await buildTransparentBackgroundSessionOptions(true, {
      decodingInfo: async () => {
        throw new TypeError('WebRTC decodingInfo is not implemented');
      },
    }),
    { transparentBackground: true },
    'an inconclusive MediaCapabilities implementation must retain the compatibility path',
  );
  assert.deepEqual(
    await buildTransparentBackgroundSessionOptions(true, undefined),
    { transparentBackground: true },
    'a browser without MediaCapabilities must retain the compatibility path',
  );
  assert.deepEqual(
    await buildTransparentBackgroundSessionOptions(false, {
      decodingInfo: async () => {
        throw new Error('must not be called');
      },
    }),
    { transparentBackground: false },
  );

  const ordinarySdp = [
    'v=0',
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
    'a=rtpmap:96 H264/90000',
    'a=fmtp:96 profile-level-id=4d001f;packetization-mode=1',
    'a=rtpmap:97 H264/90000',
    'a=fmtp:97 profile-level-id=42e01f;packetization-mode=1',
    'a=rtpmap:98 H264/90000',
    'a=fmtp:98 profile-level-id=4d002a;packetization-mode=1',
    'a=rtpmap:99 AV1/90000',
    'a=fmtp:99 profile-level-id=4d001f',
    'a=x-profile-level-id:4d001f',
    '',
  ].join('\r\n');
  const promotedSdp = promotePackedAlphaH264Level(ordinarySdp);
  assert.match(promotedSdp, /profile-level-id=4d0028/);
  assert.doesNotMatch(
    promotedSdp,
    /a=fmtp:96 profile-level-id=4d001f/,
    'the target H264 payload must no longer advertise Main Level 3.1',
  );
  assert.match(promotedSdp, /profile-level-id=42e01f/);
  assert.match(promotedSdp, /profile-level-id=4d002a/);
  assert.match(
    promotedSdp,
    /a=fmtp:99 profile-level-id=4d001f/,
    'an fmtp parameter belonging to a non-H264 payload must not be rewritten',
  );
  assert.match(
    promotedSdp,
    /a=x-profile-level-id:4d001f/,
    'an unrelated SDP attribute must not be rewritten',
  );

  const ordinaryOffer = { type: 'offer', sdp: ordinarySdp };
  assert.strictEqual(
    prepareOfferForTransparentBackgroundTransport(ordinaryOffer, undefined),
    ordinaryOffer,
    'ordinary sessions must not rewrite or clone their offer',
  );
  const packedOffer = prepareOfferForTransparentBackgroundTransport(
    ordinaryOffer,
    PACKED_ALPHA_TRANSPORT,
  );
  assert.notStrictEqual(packedOffer, ordinaryOffer);
  assert.equal(packedOffer.type, 'offer');
  assert.equal(packedOffer.sdp, promotedSdp);
  assert.equal(
    ordinaryOffer.sdp,
    ordinarySdp,
    'SDP rewriting must not mutate the browser-created offer',
  );

  console.log('packed alpha transport harness passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
