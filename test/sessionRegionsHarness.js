const assert = require('node:assert/strict');
const { unsafe_createClientWithApiKey } = require('../dist/main');

const personaConfig = {
  personaId: 'persona-1',
  name: 'Cara',
  avatarId: 'avatar-1',
  voiceId: 'voice-1',
  llmId: 'llm-1',
};

async function runHarness() {
  const requests = [];
  let includeRegion = true;
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).includes('/auth/session-token')) {
      return {
        ok: true,
        status: 201,
        json: async () => ({ sessionToken: 'session-token' }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        sessionId: 'session-1',
        engineHost: 'engine.test',
        engineProtocol: 'https',
        signallingEndpoint: '/ws',
        clientConfig: {
          heartbeatIntervalSeconds: 5,
          maxWsReconnectionAttempts: 3,
          iceServers: [],
        },
        ...(includeRegion ? { region: 'eu' } : {}),
      }),
    };
  };

  const client = unsafe_createClientWithApiKey('api-key', personaConfig, {
    sessionRegion: { region: 'eu', regionPolicy: 'strict' },
  });
  assert.equal(client.getActiveSessionRegion(), null);
  await client.startSession();

  assert.deepEqual(requests[0].body.sessionOptions, {
    region: 'eu',
    regionPolicy: 'strict',
  });
  assert.equal(client.getActiveSessionRegion(), 'eu');
  await client.stopStreaming();
  assert.equal(client.getActiveSessionRegion(), null);

  includeRegion = false;
  await client.startSession();
  assert.equal(client.getActiveSessionRegion(), null);
  await client.stopStreaming();
}

runHarness()
  .then(() => {
    console.log('session regions harness passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
