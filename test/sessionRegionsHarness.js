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
  let includeRegion = true;
  let failStreamingClientInit = false;
  global.fetch = async (url) => {
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
        engineHost: failStreamingClientInit ? '' : 'engine.test',
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

  const client = unsafe_createClientWithApiKey('api-key', personaConfig);
  assert.equal(client.getActiveSessionRegion(), null);
  await client.startSession();

  assert.equal(client.getActiveSessionRegion(), 'eu');
  await client.stopStreaming();
  assert.equal(client.getActiveSessionRegion(), null);

  includeRegion = false;
  await client.startSession();
  assert.equal(client.getActiveSessionRegion(), null);
  await client.stopStreaming();

  includeRegion = true;
  failStreamingClientInit = true;
  await assert.rejects(
    client.startSession(),
    /Failed to initialize streaming client/,
  );
  assert.equal(client.getActiveSessionRegion(), null);
}

runHarness()
  .then(() => {
    console.log('session regions harness passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
