const assert = require('node:assert/strict');
const { ToolCallManager } = require('../dist/main/modules/ToolCallManager');
const {
  InternalEventEmitter,
} = require('../dist/main/modules/InternalEventEmitter');
const {
  PublicEventEmitter,
} = require('../dist/main/modules/PublicEventEmitter');
const { InternalEvent } = require('../dist/main/types');

const SESSION_ID = 'session-1';

function createManager() {
  const internal = new InternalEventEmitter();
  const results = [];
  internal.addListener(InternalEvent.TOOL_CALL_RESULT_READY, (payload) => {
    results.push(payload);
  });
  const manager = new ToolCallManager(new PublicEventEmitter(), internal);
  manager.setActiveSession(SESSION_ID);
  return { manager, results };
}

let callCount = 0;
function startedEvent(toolName, toolType = 'client') {
  callCount += 1;
  return {
    event_uid: `event-${callCount}`,
    session_id: SESSION_ID,
    tool_call_id: `call-${callCount}`,
    tool_name: toolName,
    tool_type: toolType,
    arguments: { query: 'shoes' },
    timestamp: new Date().toISOString(),
    timestamp_user_action: new Date().toISOString(),
    user_action_correlation_id: `correlation-${callCount}`,
    used_outside_engine: true,
  };
}

async function captureWarnings(fn) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

async function testDoubleUnderscoreHandlerReceivesExactName() {
  const { manager, results } = createManager();
  const received = [];
  manager.registerHandler('catalog__lookup', {
    onStart: async (payload) => {
      received.push(payload.toolName);
      return 'ok';
    },
  });

  const event = startedEvent('catalog__lookup');
  await manager.processToolCallStartedEvent(event);

  assert.deepEqual(received, ['catalog__lookup']);
  assert.equal(results.length, 1);
  assert.equal(results[0].toolCallId, event.tool_call_id);
  assert.equal(results[0].result, 'ok');
  assert.equal(results[0].errorMessage, undefined);
}

async function testNamesDifferingInUnderscoresDispatchSeparately() {
  const { manager } = createManager();
  const received = [];
  for (const name of ['catalog_lookup', 'catalog__lookup']) {
    manager.registerHandler(name, {
      onStart: async (payload) => {
        received.push(`${name}<-${payload.toolName}`);
        return name;
      },
    });
  }

  await manager.processToolCallStartedEvent(startedEvent('catalog__lookup'));
  await manager.processToolCallStartedEvent(startedEvent('catalog_lookup'));

  assert.deepEqual(received, [
    'catalog__lookup<-catalog__lookup',
    'catalog_lookup<-catalog_lookup',
  ]);
}

async function testUnmatchedClientToolWarnsOncePerName() {
  const { manager, results } = createManager();
  let called = false;
  manager.registerHandler('catalog__lookup', {
    onStart: async () => {
      called = true;
      return 'ok';
    },
  });

  const warnings = await captureWarnings(async () => {
    await manager.processToolCallStartedEvent(startedEvent('catalog_lookup'));
    await manager.processToolCallStartedEvent(startedEvent('catalog_lookup'));
  });

  assert.equal(called, false);
  assert.equal(results.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"catalog_lookup"/);
  assert.match(warnings[0], /exact name/);
  assert.match(warnings[0], /"catalog__lookup"/);

  // A new session warns again.
  manager.setActiveSession('session-2');
  const event = { ...startedEvent('catalog_lookup'), session_id: 'session-2' };
  const nextWarnings = await captureWarnings(() =>
    manager.processToolCallStartedEvent(event),
  );
  assert.equal(nextWarnings.length, 1);
}

async function testNoWarningWithoutRegisteredHandlers() {
  // Apps that only listen to TOOL_CALL_STARTED register no handlers.
  const { manager } = createManager();
  const warnings = await captureWarnings(() =>
    manager.processToolCallStartedEvent(startedEvent('catalog_lookup')),
  );
  assert.equal(warnings.length, 0);
}

async function testNoWarningForServerTools() {
  const { manager } = createManager();
  manager.registerHandler('catalog__lookup', { onStart: async () => 'ok' });
  const warnings = await captureWarnings(() =>
    manager.processToolCallStartedEvent(
      startedEvent('knowledge_search', 'server'),
    ),
  );
  assert.equal(warnings.length, 0);
}

async function main() {
  await testDoubleUnderscoreHandlerReceivesExactName();
  await testNamesDifferingInUnderscoresDispatchSeparately();
  await testUnmatchedClientToolWarnsOncePerName();
  await testNoWarningWithoutRegisteredHandlers();
  await testNoWarningForServerTools();
  console.log('tool call handler harness passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
