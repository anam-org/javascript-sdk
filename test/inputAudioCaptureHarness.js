const assert = require('assert');
const {
  buildInputAudioConstraints,
  detectInputAudioBrowser,
  detectInputAudioPlatform,
  reportInputAudioSettings,
  serializeAppliedInputAudioSettings,
} = require('../dist/main/lib/InputAudioCapture');
const {
  setClientMetricsBaseUrl,
  setClientMetricsDisabled,
  setMetricsContext,
} = require('../dist/main/lib/ClientMetrics');

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

async function runHarness() {
  const defaultConstraints = buildInputAudioConstraints();
  assert.deepEqual(defaultConstraints, {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    voiceIsolation: true,
    channelCount: { ideal: 1 },
  });

  const deviceConstraints = buildInputAudioConstraints('microphone-1');
  assert.deepEqual(deviceConstraints, {
    ...defaultConstraints,
    deviceId: { exact: 'microphone-1' },
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(defaultConstraints, 'deviceId'),
    false,
    'adding a device must not mutate the default constraint object',
  );

  assert.deepEqual(
    serializeAppliedInputAudioSettings({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      channelCount: 1,
    }),
    {
      echoCancellation: 'true',
      noiseSuppression: 'false',
      autoGainControl: 'true',
      voiceIsolation: 'unreported',
      channelCount: 1,
    },
  );

  assert.deepEqual(
    serializeAppliedInputAudioSettings({
      echoCancellation: 'remote-only',
      voiceIsolation: true,
    }),
    {
      echoCancellation: 'true',
      noiseSuppression: 'unreported',
      autoGainControl: 'unreported',
      voiceIsolation: 'true',
      channelCount: 0,
    },
  );

  assert.equal(
    detectInputAudioPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' }),
    'android',
  );
  assert.equal(
    detectInputAudioPlatform({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)',
    }),
    'ios',
  );
  assert.equal(
    detectInputAudioPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }),
    'ios',
  );
  assert.equal(
    detectInputAudioPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }),
    'desktop',
  );
  assert.equal(detectInputAudioPlatform(null), 'unknown');

  assert.equal(
    detectInputAudioBrowser({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    }),
    'edge',
  );
  assert.equal(
    detectInputAudioBrowser({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
    }),
    'firefox',
  );
  assert.equal(
    detectInputAudioBrowser({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    }),
    'chrome',
  );
  assert.equal(
    detectInputAudioBrowser({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
    }),
    'chrome',
  );
  assert.equal(
    detectInputAudioBrowser({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    }),
    'safari',
  );
  assert.equal(detectInputAudioBrowser(null), 'other');

  const capturedMetrics = [];
  reportInputAudioSettings(
    {
      getSettings: () => ({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        voiceIsolation: true,
        channelCount: 1,
      }),
    },
    'device_change',
    {
      platform: 'ios',
      browser: 'safari',
      sendMetrics: async (metrics) => {
        capturedMetrics.push(...metrics);
      },
    },
  );
  assert.deepEqual(capturedMetrics, [
    {
      name: 'client_input_audio_settings',
      value: 'device_change',
      tags: { platform: 'ios', browser: 'safari' },
      fields: {
        echoCancellation: 'true',
        noiseSuppression: 'true',
        autoGainControl: 'false',
        voiceIsolation: 'true',
        channelCount: 1,
      },
    },
  ]);

  assert.doesNotThrow(() =>
    reportInputAudioSettings({ getSettings: () => ({}) }, 'initial', {
      sendMetrics: () => {
        throw new Error('synchronous telemetry failure');
      },
    }),
  );
  reportInputAudioSettings({ getSettings: () => ({}) }, 'initial', {
    sendMetrics: async () => {
      throw new Error('asynchronous telemetry failure');
    },
  });
  await flushPromises();

  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true };
  };
  setClientMetricsBaseUrl('https://api.example.com');
  setMetricsContext({
    sessionId: 'session-1',
    organizationId: 'organization-1',
    attemptCorrelationId: 'attempt-1',
  });
  setClientMetricsDisabled(false);

  reportInputAudioSettings(
    {
      getSettings: () => ({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        voiceIsolation: false,
        channelCount: 2,
      }),
    },
    'user_provided',
    { platform: 'desktop', browser: 'chrome' },
  );
  await flushPromises();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].name, 'client_input_audio_settings');
  assert.equal(requests[0].value, 'user_provided');
  assert.deepEqual(requests[0].tags, {
    client: 'js-sdk',
    version: '0.0.0-automated',
    platform: 'desktop',
    browser: 'chrome',
    sessionId: 'session-1',
    organizationId: 'organization-1',
    attemptCorrelationId: 'attempt-1',
  });
  assert.deepEqual(requests[0].fields, {
    echoCancellation: 'true',
    noiseSuppression: 'true',
    autoGainControl: 'true',
    voiceIsolation: 'false',
    channelCount: 2,
  });

  setClientMetricsDisabled(true);
  reportInputAudioSettings(
    { getSettings: () => ({ echoCancellation: true }) },
    'initial',
  );
  await flushPromises();
  assert.equal(
    requests.length,
    1,
    'disabled client telemetry must not issue a request',
  );
  setClientMetricsDisabled(false);
}

runHarness()
  .then(() => {
    console.log('input audio capture harness passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
