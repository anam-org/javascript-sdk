const assert = require('node:assert/strict');
const AnamClient = require('../dist/main/AnamClient').default;
const { DIRECTOR_NOTE_CUE_TAGS } = require('../dist/main');
const { ClientError, ErrorCode } = require('../dist/main/lib/ClientError');
const {
  CoreApiRestClient,
} = require('../dist/main/modules/CoreApiRestClient');

const personaConfig = {
  personaId: 'persona-1',
  name: 'Cara',
  avatarId: 'avatar-1',
  voiceId: 'voice-1',
  llmId: 'llm-1',
  directorNotes: { presetStyle: 'warm', expressivity: 0 },
};

async function testSessionTokenPayload() {
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 201,
      json: async () => ({ sessionToken: 'session-token' }),
    };
  };

  const client = new CoreApiRestClient(undefined, 'api-key');
  const token = await client.unsafe_getSessionToken(personaConfig);

  assert.equal(token, 'session-token');
  assert.deepEqual(requests, [
    { clientLabel: 'js-sdk-api-key', personaConfig },
  ]);
}

async function testTypedConfigWithoutLlmIsForwarded() {
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 201,
      json: async () => ({ sessionToken: 'legacy-token' }),
    };
  };

  const client = new CoreApiRestClient(undefined, 'api-key');
  const { llmId: _llmId, ...brainlessConfig } = personaConfig;
  await client.unsafe_getSessionToken(brainlessConfig);

  assert.deepEqual(requests, [
    { clientLabel: 'js-sdk-api-key', personaConfig: brainlessConfig },
  ]);
}

async function testSessionTokenErrorsAreSurfaced() {
  const metricRequests = [];
  global.fetch = async (url, options) => {
    if (String(url).includes('/metrics/client')) {
      metricRequests.push(JSON.parse(options.body));
      return { ok: true, status: 204, json: async () => ({}) };
    }
    return {
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Invalid request body',
        details: {
          personaConfig: {
            directorNotes: {
              presetStyle: { _errors: ['Invalid Director Notes preset'] },
            },
          },
        },
      }),
    };
  };

  const client = new CoreApiRestClient(undefined, 'api-key');
  await assert.rejects(
    client.unsafe_getSessionToken(personaConfig),
    (error) =>
      error instanceof ClientError &&
      error.code === ErrorCode.CLIENT_ERROR_CODE_VALIDATION_ERROR &&
      error.statusCode === 400 &&
      error.details?.cause === 'Invalid request body' &&
      error.details?.responseBody?.details?.personaConfig?.directorNotes
        ?.presetStyle?._errors?.[0] === 'Invalid Director Notes preset',
  );
  assert.equal(metricRequests.length, 1);
  assert.deepEqual(metricRequests[0].tags.details, {
    cause: 'Invalid request body',
  });

  for (const status of [400, 401, 403]) {
    global.fetch = async () => ({
      ok: false,
      status,
      json: async () => {
        throw new SyntaxError('Unexpected non-JSON response');
      },
    });
    await assert.rejects(
      client.unsafe_getSessionToken(personaConfig),
      (error) =>
        error instanceof ClientError &&
        error.code ===
          (status === 400
            ? ErrorCode.CLIENT_ERROR_CODE_VALIDATION_ERROR
            : ErrorCode.CLIENT_ERROR_CODE_AUTHENTICATION_ERROR) &&
        error.statusCode === status &&
        error.details?.cause ===
          `Request failed with HTTP status ${status}`,
    );
  }

  global.fetch = async () => ({
    ok: true,
    status: 201,
    json: async () => ({}),
  });
  await assert.rejects(
    client.unsafe_getSessionToken(personaConfig),
    (error) =>
      error instanceof ClientError &&
      error.code === ErrorCode.CLIENT_ERROR_CODE_SERVER_ERROR &&
      error.statusCode === 500 &&
      error.details?.cause === 'Response did not include a session token',
  );
}

function createStreamingClient({ isOpen = true } = {}) {
  const messages = [];
  const client = Object.create(AnamClient.prototype);
  client._isStreaming = true;
  client.streamingClient = {
    sendDataMessage: (message) => {
      if (!isOpen) return false;
      messages.push(JSON.parse(message));
      return true;
    },
  };
  return { client, messages };
}

function testDirectorNoteCues() {
  assert.deepEqual(DIRECTOR_NOTE_CUE_TAGS, [
    'happy',
    'warm',
    'playful',
    'laughter',
    'curious',
    'supportive',
    'concerned',
    'sad',
    'surprised',
    'angry',
    'distressed',
  ]);

  const notStreaming = createStreamingClient().client;
  notStreaming._isStreaming = false;
  assert.throws(
    () => notStreaming.sendDirectorNoteCue('happy'),
    /not currently streaming/,
  );

  const { client, messages } = createStreamingClient();
  client.sendDirectorNoteCue('happy');
  client.sendDirectorNoteCue('curious', { inSeconds: 0 });
  client.sendDirectorNoteCue('surprised', { atSeconds: 1.25 });

  assert.deepEqual(messages, [
    {
      message_type: 'director_note_cue',
      cue: { tag: 'happy' },
    },
    {
      message_type: 'director_note_cue',
      cue: { tag: 'curious' },
      in_seconds: 0,
    },
    {
      message_type: 'director_note_cue',
      cue: { tag: 'surprised' },
      at_seconds: 1.25,
    },
  ]);

  assert.throws(
    () => client.sendDirectorNoteCue(''),
    /tag must not be empty/,
  );
  assert.throws(
    () => client.sendDirectorNoteCue('x'.repeat(65)),
    /tag must not exceed 64 bytes/,
  );
  assert.throws(
    () => client.sendDirectorNoteCue('😀'.repeat(17)),
    /tag must not exceed 64 bytes/,
  );
  assert.throws(
    () => client.sendDirectorNoteCue('rage'),
    /unsupported tag "rage"/,
  );
  assert.throws(
    () => client.sendDirectorNoteCue('neutral'),
    /unsupported tag "neutral"/,
  );
  assert.throws(
    () =>
      client.sendDirectorNoteCue('happy', {
        inSeconds: 0,
        atSeconds: 1,
      }),
    /provide only one of inSeconds or atSeconds/,
  );
  for (const timing of [-0.01, NaN, Infinity, -Infinity]) {
    assert.throws(
      () => client.sendDirectorNoteCue('happy', { inSeconds: timing }),
      /inSeconds must be a finite non-negative number/,
    );
    assert.throws(
      () => client.sendDirectorNoteCue('happy', { atSeconds: timing }),
      /atSeconds must be a finite non-negative number/,
    );
  }

  const unavailable = createStreamingClient({ isOpen: false }).client;
  assert.throws(
    () => unavailable.sendDirectorNoteCue('happy'),
    /data channel is not open/,
  );
}

function testInitialExpressivityValidation() {
  for (const expressivity of [-0.01, 1.01, NaN, Infinity, -Infinity]) {
    assert.throws(
      () =>
        new AnamClient(
          undefined,
          {
            ...personaConfig,
            directorNotes: { expressivity },
          },
          { apiKey: 'api-key' },
        ),
      (error) =>
        error instanceof ClientError &&
        error.code === ErrorCode.CLIENT_ERROR_CODE_CONFIGURATION_ERROR &&
        /finite number between 0 and 1/.test(error.message),
    );
  }
}

async function testChangedConfigExpressivityValidation() {
  const client = new AnamClient(undefined, personaConfig, {
    apiKey: 'api-key',
  });
  const invalidConfig = {
    ...personaConfig,
    directorNotes: { expressivity: NaN },
  };

  assert.throws(
    () => client.setPersonaConfig(invalidConfig),
    (error) =>
      error instanceof ClientError &&
      error.code === ErrorCode.CLIENT_ERROR_CODE_CONFIGURATION_ERROR &&
      /finite number between 0 and 1/.test(error.message),
  );

  const mutableConfig = {
    ...personaConfig,
    directorNotes: { expressivity: 0.5 },
  };
  const mutableClient = new AnamClient(undefined, mutableConfig, {
    apiKey: 'api-key',
  });
  mutableConfig.directorNotes.expressivity = Infinity;
  let apiCalled = false;
  mutableClient.apiClient = {
    startSession: async () => {
      apiCalled = true;
      throw new Error('API should not be called');
    },
  };

  await assert.rejects(
    mutableClient.startSession(),
    (error) =>
      error instanceof ClientError &&
      error.code === ErrorCode.CLIENT_ERROR_CODE_CONFIGURATION_ERROR,
  );
  assert.equal(apiCalled, false);
}

async function runHarness() {
  await testSessionTokenPayload();
  await testTypedConfigWithoutLlmIsForwarded();
  await testSessionTokenErrorsAreSurfaced();
  testDirectorNoteCues();
  testInitialExpressivityValidation();
  await testChangedConfigExpressivityValidation();
  console.log('director notes harness passed');
}

runHarness().catch((error) => {
  console.error(error);
  process.exit(1);
});
