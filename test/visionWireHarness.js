const assert = require('node:assert/strict');
const {
  toSceneStateUpdatedEvent,
  toStatusChangedEvent,
  toSourceFailedEvent,
  toProactiveTriggerEvent,
} = require('../dist/main/lib/visionWire');

function testSceneStateConversion() {
  const event = toSceneStateUpdatedEvent({
    scene_state: {
      version: 7,
      generated_at_ms: 1000,
      stale: false,
      sources: {
        camera: {
          source: 'camera',
          captured_at_ms: 900,
          analyzed_at_ms: 950,
          asset_id: 'va_abc',
          summary: 'One person at a desk.',
          people: [
            {
              temporary_id: 'p1',
              bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
              gaze_direction: 'camera',
            },
          ],
          entities: [{ label: 'mug' }],
        },
        // Sources this SDK does not know are dropped.
        drone: {
          source: 'drone',
          captured_at_ms: 1,
          analyzed_at_ms: 1,
          summary: '',
        },
      },
    },
    staleness_ms: 50,
  });
  assert.equal(event.sceneState.version, 7);
  assert.equal(event.stalenessMs, 50);
  assert.deepEqual(Object.keys(event.sceneState.sources), ['camera']);
  const camera = event.sceneState.sources.camera;
  assert.equal(camera.assetId, 'va_abc');
  assert.equal(camera.people[0].temporaryId, 'p1');
  assert.equal(camera.people[0].gazeDirection, 'camera');
  assert.deepEqual(camera.people[0].bounds, {
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
  });
  assert.equal(camera.entities[0].label, 'mug');
  assert.deepEqual(camera.changes, []);
}

function testStatusDropsUnknownValues() {
  const event = toStatusChangedEvent({
    timestamp_ms: 1,
    sources: { camera: 'active', screen: 'paused', drone: 'active' },
    provider_healthy: true,
    scene_state_version: 3,
  });
  assert.deepEqual(event.sources, { camera: 'active' });
  assert.equal(event.providerHealthy, true);
}

function testSourceFailedNormalizesStage() {
  assert.equal(
    toSourceFailedEvent({
      source: 'screen',
      timestamp_ms: 1,
      stage: 'decode',
      message: 'x',
    }).stage,
    'decode',
  );
  assert.equal(
    toSourceFailedEvent({
      source: 'screen',
      timestamp_ms: 1,
      stage: 'future',
      message: 'x',
    }).stage,
    'analysis',
  );
  assert.equal(
    toSourceFailedEvent({
      source: 'drone',
      timestamp_ms: 1,
      stage: 'decode',
      message: 'x',
    }),
    null,
  );
}

function testProactiveTrigger() {
  const event = toProactiveTriggerEvent({
    trigger_id: 't1',
    source: 'screen',
    timestamp_ms: 5,
    goal: 'error dialog appears',
    observation: 'An error dialog is visible.',
    scene_state_version: 9,
  });
  assert.equal(event.triggerId, 't1');
  assert.equal(event.sceneStateVersion, 9);
}

testSceneStateConversion();
testStatusDropsUnknownValues();
testSourceFailedNormalizesStage();
testProactiveTrigger();
console.log('vision wire harness passed');
