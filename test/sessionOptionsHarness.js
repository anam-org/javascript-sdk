const assert = require('assert');
const { unsafe_createClientWithApiKey } = require('../dist/main');

const personaConfig = {
  personaId: 'persona-id',
  name: 'Cara',
  avatarId: 'avatar-id',
  voiceId: 'voice-id',
};

const requests = [];
global.fetch = async (url, options) => {
  requests.push({ url, body: JSON.parse(options.body) });
  if (url.endsWith('/auth/session-token')) {
    return { status: 200, json: async () => ({ sessionToken: 'token' }) };
  }
  if (url.endsWith('/engine/session')) {
    return { status: 201, json: async () => ({ sessionId: 'session-id' }) };
  }
  return { status: 204, json: async () => ({}) };
};

const getTokenRequests = () =>
  requests.filter(({ url }) => url.endsWith('/auth/session-token'));

async function runHarness() {
  const client = unsafe_createClientWithApiKey('api-key', personaConfig, {
    sessionOptions: {
      videoQuality: 'auto',
      videoWidth: 768,
      videoHeight: 1152,
    },
  });

  await client.apiClient.startSession(personaConfig);

  assert.deepEqual(getTokenRequests()[0].body, {
    clientLabel: 'js-sdk-api-key',
    personaConfig,
    sessionOptions: {
      videoQuality: 'auto',
      videoWidth: 768,
      videoHeight: 1152,
    },
  });

  const tokenRequestCount = getTokenRequests().length;
  for (const sessionOptions of [
    { videoWidth: 768 },
    { videoHeight: 1152 },
    { videoWidth: 0, videoHeight: 1152 },
    { videoWidth: 768.5, videoHeight: 1152 },
  ]) {
    const invalidClient = unsafe_createClientWithApiKey(
      'api-key',
      personaConfig,
      { sessionOptions },
    );
    await assert.rejects(
      () => invalidClient.apiClient.startSession(personaConfig),
      (error) => error.statusCode === 400,
    );
  }

  assert.equal(
    getTokenRequests().length,
    tokenRequestCount,
    'invalid dimensions should fail before session-token creation',
  );
}

runHarness()
  .then(() => {
    console.log('session options harness passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
