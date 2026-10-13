const assert = require('node:assert/strict');
const {
  InternalEventEmitter,
} = require('../dist/main/modules/InternalEventEmitter');
const { InternalEvent } = require('../dist/main/types');
const { TalkMessageStream } = require('../dist/main/types/TalkMessageStream');
const {
  TalkMessageStreamState,
} = require('../dist/main/types/TalkMessageStreamState');

function fakeStream(correlationId = 'corr-1') {
  const internalEmitter = new InternalEventEmitter();
  const sent = [];
  const stream = new TalkMessageStream(correlationId, internalEmitter, {
    sendTalkMessage: async (payload) => sent.push(payload),
  });
  return { stream, sent, internalEmitter };
}

async function testSequenceStampsEveryChunkAndTerminator() {
  const { stream, sent } = fakeStream();
  await stream.streamMessageChunk('a', false);
  await stream.streamMessageChunk('b', false);
  await stream.endMessage();
  assert.deepEqual(
    sent.map((p) => p.sequence),
    [0, 1, 2],
  );
}

async function testRejectedChunkDoesNotConsumeSequence() {
  const { stream, sent } = fakeStream();
  await assert.rejects(() => stream.streamMessageChunk('a', false, 'bad-id'));
  await stream.streamMessageChunk('a', true);
  assert.deepEqual(
    sent.map((p) => p.sequence),
    [0],
  );
}

async function testDeliveryFailedMakesActiveStreamTerminal() {
  const { stream, internalEmitter } = fakeStream();
  await stream.streamMessageChunk('a', false);
  internalEmitter.emit(InternalEvent.TALK_STREAM_DELIVERY_FAILED, 'other');
  assert.equal(stream.getState(), TalkMessageStreamState.STREAMING);
  internalEmitter.emit(InternalEvent.TALK_STREAM_DELIVERY_FAILED, 'corr-1');
  assert.equal(stream.getState(), TalkMessageStreamState.DELIVERY_FAILED);
  assert.equal(stream.isActive(), false);
  await assert.rejects(
    () => stream.streamMessageChunk('b', false),
    /not in an active state/,
  );
}

async function testEndedStreamIgnoresDeliveryFailed() {
  const { stream, internalEmitter } = fakeStream();
  await stream.streamMessageChunk('a', true);
  internalEmitter.emit(InternalEvent.TALK_STREAM_DELIVERY_FAILED, 'corr-1');
  assert.equal(stream.getState(), TalkMessageStreamState.ENDED);
}

function listenerCount(emitter, event) {
  return emitter.listeners[event]?.size ?? 0;
}

async function testDeactivateRemovesListeners() {
  const { stream, internalEmitter } = fakeStream();
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.SIGNAL_MESSAGE_RECEIVED),
    1,
  );
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.TALK_STREAM_DELIVERY_FAILED),
    1,
  );
  await stream.streamMessageChunk('a', true);
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.SIGNAL_MESSAGE_RECEIVED),
    0,
  );
  assert.equal(
    listenerCount(internalEmitter, InternalEvent.TALK_STREAM_DELIVERY_FAILED),
    0,
  );
}

async function main() {
  await testSequenceStampsEveryChunkAndTerminator();
  await testRejectedChunkDoesNotConsumeSequence();
  await testDeliveryFailedMakesActiveStreamTerminal();
  await testEndedStreamIgnoresDeliveryFailed();
  await testDeactivateRemovesListeners();
  console.log('talkStreamDeliveryHarness: all tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
