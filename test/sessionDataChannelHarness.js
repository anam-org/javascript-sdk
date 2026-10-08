const assert = require('node:assert/strict');
const {
  answerAcceptsNegotiatedSessionDataChannel,
  NEGOTIATED_SESSION_DATA_CHANNEL_ID,
} = require('../dist/main/lib/sessionDataChannel');

const answer = { type: 'answer', sdp: 'v=0\r\n' };

function testAcceptsEchoedId() {
  assert.equal(
    answerAcceptsNegotiatedSessionDataChannel(
      { ...answer, negotiatedSessionDataChannelId: 0 },
      NEGOTIATED_SESSION_DATA_CHANNEL_ID,
    ),
    true,
  );
}

function testRejectsAnswerWithoutId() {
  // Older servers and the flag-off arm answer with the bare session description.
  assert.equal(
    answerAcceptsNegotiatedSessionDataChannel(
      answer,
      NEGOTIATED_SESSION_DATA_CHANNEL_ID,
    ),
    false,
  );
}

function testRejectsMismatchedOrMalformedId() {
  for (const value of [1, '0', null, true]) {
    assert.equal(
      answerAcceptsNegotiatedSessionDataChannel(
        { ...answer, negotiatedSessionDataChannelId: value },
        NEGOTIATED_SESSION_DATA_CHANNEL_ID,
      ),
      false,
      `id ${JSON.stringify(value)} must not be accepted`,
    );
  }
  for (const value of [null, undefined, 'answer']) {
    assert.equal(
      answerAcceptsNegotiatedSessionDataChannel(
        value,
        NEGOTIATED_SESSION_DATA_CHANNEL_ID,
      ),
      false,
    );
  }
}

testAcceptsEchoedId();
testRejectsAnswerWithoutId();
testRejectsMismatchedOrMalformedId();
console.log('sessionDataChannelHarness: ok');
