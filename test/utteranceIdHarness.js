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
const { TalkMessageStream } = require('../dist/main/types/TalkMessageStream');

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

function testPublishedMessageIsNotMutatedByLaterChunks() {
  const { getHistory, emit } = setup();
  emit(
    personaChunk({
      content: 'Hello',
      utterance_id: 'uuid-a',
      end_of_speech: true,
    }),
  );
  const publishedMessage = getHistory()[0];

  emit(
    personaChunk({
      content: ' again',
      content_index: 1,
      utterance_id: 'uuid-a',
      end_of_speech: true,
    }),
  );

  assert.equal(publishedMessage.content, 'Hello');
  assert.deepEqual(publishedMessage.utterances, [
    { id: 'uuid-a', content: 'Hello' },
  ]);
  assert.equal(getHistory()[0].content, 'Hello again');
  assert.deepEqual(getHistory()[0].utterances, [
    { id: 'uuid-a', content: 'Hello again' },
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

const UTTERANCE_A = '68fd86b6-0b3a-4f42-bf92-5866cd84f8ac';
const UTTERANCE_B = 'd990d82a-29a5-4874-b870-a9f07e024108';

function talkStream() {
  const sent = [];
  const stream = new TalkMessageStream(
    'corr-1',
    new InternalEventEmitter(),
    { sendTalkMessage: async (payload) => sent.push(payload) },
  );
  return { stream, sent };
}

async function testTalkStreamChunkCarriesUtteranceId() {
  const { stream, sent } = talkStream();
  await stream.streamMessageChunk('Hello', false, UTTERANCE_A);
  await stream.streamMessageChunk(' again', false);
  await stream.streamMessageChunk(' bye', true, UTTERANCE_B);

  assert.equal(sent[0].utteranceId, UTTERANCE_A);
  assert.ok(!('utteranceId' in sent[1]));
  assert.equal(sent[2].utteranceId, UTTERANCE_B);
  assert.equal(sent[0].startOfSpeech, true);
  assert.equal(sent[2].endOfSpeech, true);
}

async function testRejectsUtteranceIdThatIsNotLowercaseUuidV4() {
  const badIds = [
    '',
    'utterance-1',
    'a8098c1a-f86e-11da-bd1a-00112444be1e', // v1, not v4
    UTTERANCE_A.toUpperCase(), // the engine only round-trips the lowercase form
  ];
  for (const badId of badIds) {
    const { stream, sent } = talkStream();
    await assert.rejects(
      () => stream.streamMessageChunk('Hello', false, badId),
      /utteranceId must be a lowercase UUID v4 string/,
    );
    assert.equal(sent.length, 0);
  }
}

async function testEndMessageReusesLastUtteranceId() {
  const { stream, sent } = talkStream();
  await stream.streamMessageChunk('Hello', false, UTTERANCE_A);
  await stream.streamMessageChunk(' world', false, UTTERANCE_B);
  await stream.endMessage();

  const terminator = sent[sent.length - 1];
  assert.equal(terminator.endOfSpeech, true);
  assert.equal(terminator.utteranceId, UTTERANCE_B);
}

async function testEndMessageOmitsUtteranceIdWhenNeverTagged() {
  const { stream, sent } = talkStream();
  await stream.streamMessageChunk('Hello', false);
  await stream.endMessage();

  assert.ok(!('utteranceId' in sent[sent.length - 1]));
}

async function main() {
  testUtteranceIdExposedOnStreamEvents();
  testMissingOrEmptyUtteranceIdOmitted();
  testHistorySplitsUtterancesKeepsTurnShape();
  testHistoryPreservesNonSeparatorWhitespace();
  testPublishedMessageIsNotMutatedByLaterChunks();
  testHistoryShapeUnchangedWithoutUtteranceIds();
  await testTalkStreamChunkCarriesUtteranceId();
  await testRejectsUtteranceIdThatIsNotLowercaseUuidV4();
  await testEndMessageReusesLastUtteranceId();
  await testEndMessageOmitsUtteranceIdWhenNeverTagged();
  console.log('utteranceIdHarness: all tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
