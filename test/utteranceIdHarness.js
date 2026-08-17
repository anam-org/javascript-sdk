const assert = require('node:assert/strict');
const {
  MessageHistoryClient,
} = require('../dist/main/modules/MessageHistoryClient');
const {
  PublicEventEmitter,
} = require('../dist/main/modules/PublicEventEmitter');
const {
  InternalEventEmitter,
} = require('../dist/main/modules/InternalEventEmitter');
const { AnamEvent, InternalEvent } = require('../dist/main/types');

function setup() {
  const publicEmitter = new PublicEventEmitter();
  const internalEmitter = new InternalEventEmitter();
  const client = new MessageHistoryClient(publicEmitter, internalEmitter);
  const streamEvents = [];
  let history = null;
  publicEmitter.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (e) =>
    streamEvents.push(e),
  );
  publicEmitter.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
    history = messages;
  });
  const emit = (event) =>
    internalEmitter.emit(InternalEvent.WEBRTC_CHAT_MESSAGE_RECEIVED, event);
  return { client, streamEvents, getHistory: () => history, emit };
}

function personaChunk(overrides) {
  return {
    message_id: 'turn-1',
    content_index: 0,
    content: 'Hello',
    role: 'persona',
    end_of_speech: false,
    interrupted: false,
    ...overrides,
  };
}

function testUtteranceIdExposedOnStreamEvents() {
  const { streamEvents, emit } = setup();
  emit(personaChunk({ utterance_id: 'uuid-a' }));
  assert.equal(streamEvents.length, 1);
  assert.equal(streamEvents[0].utteranceId, 'uuid-a');
  assert.equal(streamEvents[0].id, 'persona::turn-1');
}

function testMissingOrEmptyUtteranceIdOmitted() {
  const { streamEvents, emit } = setup();
  emit(personaChunk({}));
  emit(personaChunk({ content_index: 1, utterance_id: '' }));
  assert.equal(streamEvents.length, 2);
  assert.ok(!('utteranceId' in streamEvents[0]));
  assert.ok(!('utteranceId' in streamEvents[1]));
}

function testHistorySplitsUtterancesKeepsTurnShape() {
  const { streamEvents, getHistory, emit } = setup();
  emit(personaChunk({ content: 'Hel', utterance_id: 'uuid-a' }));
  emit(personaChunk({ content: 'lo.', content_index: 1, utterance_id: 'uuid-a' }));
  // New utterance in the same turn: the engine prepends the joining space, which must
  // survive verbatim in turn-level content but is trimmed from the utterance itself.
  emit(
    personaChunk({
      content: ' Second thought.',
      content_index: 2,
      utterance_id: 'uuid-b',
      end_of_speech: true,
    }),
  );
  const history = getHistory();
  assert.equal(history.length, 1);
  assert.deepEqual(history[0], {
    id: 'persona::turn-1',
    content: 'Hello. Second thought.',
    role: 'persona',
    interrupted: false,
    utterances: [
      { id: 'uuid-a', content: 'Hello.' },
      { id: 'uuid-b', content: 'Second thought.' },
    ],
  });
  assert.equal(streamEvents[0].utteranceId, 'uuid-a');
  assert.equal(streamEvents[2].utteranceId, 'uuid-b');
}

function testHistoryPreservesNonSeparatorWhitespace() {
  const { getHistory, emit } = setup();
  emit(personaChunk({ content: ' Leading', utterance_id: 'uuid-a' }));
  emit(
    personaChunk({
      content: '  Second',
      content_index: 1,
      utterance_id: 'uuid-b',
      end_of_speech: true,
    }),
  );
  const history = getHistory();
  assert.equal(history[0].content, ' Leading  Second');
  assert.deepEqual(history[0].utterances, [
    { id: 'uuid-a', content: ' Leading' },
    { id: 'uuid-b', content: ' Second' },
  ]);
}

function testHistoryShapeUnchangedWithoutUtteranceIds() {
  const { getHistory, emit } = setup();
  emit(personaChunk({ content: 'Hello' }));
  emit(personaChunk({ content: ' there.', content_index: 1, end_of_speech: true }));
  const history = getHistory();
  assert.equal(history.length, 1);
  assert.deepEqual(history[0], {
    id: 'persona::turn-1',
    content: 'Hello there.',
    role: 'persona',
    interrupted: false,
  });
  assert.ok(!('utterances' in history[0]));
}

function main() {
  testUtteranceIdExposedOnStreamEvents();
  testMissingOrEmptyUtteranceIdOmitted();
  testHistorySplitsUtterancesKeepsTurnShape();
  testHistoryPreservesNonSeparatorWhitespace();
  testHistoryShapeUnchangedWithoutUtteranceIds();
  console.log('utteranceIdHarness: all tests passed');
}

main();
