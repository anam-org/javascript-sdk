const assert = require('node:assert/strict');
const AnamClient = require('../dist/main/AnamClient').default;
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
  global.fetch = async () => ({
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
  });

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

function testRuntimeUpdates() {
  const notStreaming = createStreamingClient().client;
  notStreaming._isStreaming = false;
  assert.throws(
    () => notStreaming.updateDirectorNotes({ expressivity: 0.5 }),
    /not currently streaming/,
  );

  const { client, messages } = createStreamingClient();
  client.updateDirectorNotes({ presetStyle: 'happy', expressivity: 0 });
  client.updateDirectorNotes({ presetStyle: null, expressivity: null });
  client.updateDirectorNotes({
    expressivity: 0.4,
    customStylePrompt: 'must not reach the live wire',
  });

  assert.deepEqual(messages, [
    {
      message_type: 'persona_config',
      data: { directorNotes: { presetStyle: 'happy', expressivity: 0 } },
    },
    {
      message_type: 'persona_config',
      data: { directorNotes: { presetStyle: null, expressivity: null } },
    },
    {
      message_type: 'persona_config',
      data: { directorNotes: { expressivity: 0.4 } },
    },
  ]);

  assert.throws(
    () => client.updateDirectorNotes({}),
    /provide presetStyle and\/or expressivity/,
  );
  for (const expressivity of [-0.01, 1.01, NaN, Infinity, -Infinity]) {
    assert.throws(
      () => client.updateDirectorNotes({ expressivity }),
      /finite number between 0 and 1/,
    );
  }

  const unavailable = createStreamingClient({ isOpen: false }).client;
  assert.throws(
    () => unavailable.updateDirectorNotes({ expressivity: 0.5 }),
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
  testRuntimeUpdates();
  testInitialExpressivityValidation();
  await testChangedConfigExpressivityValidation();
  console.log('director notes harness passed');
}

runHarness().catch((error) => {
  console.error(error);
  process.exit(1);
});
