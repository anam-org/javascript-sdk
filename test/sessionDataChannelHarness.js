const assert = require('node:assert/strict');
const {
  answerAcceptsNegotiatedSessionDataChannel,
  NEGOTIATED_SESSION_DATA_CHANNEL_ID,
  SessionDataChannelNegotiation,
} = require('../dist/main/lib/sessionDataChannel');

function fakePeerConnection() {
  const created = [];
  return {
    created,
    createDataChannel(label, init) {
      const channel = { label, init, closed: false };
      channel.close = () => {
        channel.closed = true;
      };
      created.push(channel);
      return channel;
    },
  };
}

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

function testCreatesNegotiatedChannelAndOffersIdUntilDecided() {
  const pc = fakePeerConnection();
  const negotiation = new SessionDataChannelNegotiation(pc);
  assert.equal(pc.created.length, 1);
  assert.deepEqual(pc.created[0].init, {
    ordered: true,
    negotiated: true,
    id: NEGOTIATED_SESSION_DATA_CHANNEL_ID,
  });
  // Initial and restart offers both carry the id while undecided.
  assert.equal(negotiation.offerId(), NEGOTIATED_SESSION_DATA_CHANNEL_ID);
  assert.equal(negotiation.offerId(), NEGOTIATED_SESSION_DATA_CHANNEL_ID);
  negotiation.resolve({ ...answer, negotiatedSessionDataChannelId: 0 });
  assert.equal(negotiation.offerId(), undefined);
}

function testKeepsNegotiatedChannelWhenAnswerEchoesId() {
  const pc = fakePeerConnection();
  const negotiation = new SessionDataChannelNegotiation(pc);
  const resolved = negotiation.resolve({
    ...answer,
    negotiatedSessionDataChannelId: 0,
  });
  assert.equal(resolved.negotiated, true);
  assert.equal(resolved.channel, pc.created[0]);
  assert.equal(pc.created.length, 1);
  assert.equal(pc.created[0].closed, false);
}

function testFallsBackToInBandChannelWithoutId() {
  const pc = fakePeerConnection();
  const negotiation = new SessionDataChannelNegotiation(pc);
  const resolved = negotiation.resolve(answer);
  assert.equal(resolved.negotiated, false);
  assert.equal(pc.created.length, 2);
  assert.equal(resolved.channel, pc.created[1]);
  assert.deepEqual(pc.created[1].init, { ordered: true });
  assert.equal(pc.created[1].label, 'session');
  assert.equal(pc.created[0].closed, true);
  assert.equal(pc.created[1].closed, false);
}

function testOnlyFirstAnswerDecides() {
  const pc = fakePeerConnection();
  const negotiation = new SessionDataChannelNegotiation(pc);
  assert.ok(
    negotiation.resolve({ ...answer, negotiatedSessionDataChannelId: 0 }),
  );
  // A later restart answer (with or without the id) changes nothing.
  assert.equal(negotiation.resolve(answer), null);
  assert.equal(
    negotiation.resolve({ ...answer, negotiatedSessionDataChannelId: 0 }),
    null,
  );
  assert.equal(pc.created.length, 1);
  assert.equal(pc.created[0].closed, false);
}

testAcceptsEchoedId();
testRejectsAnswerWithoutId();
testRejectsMismatchedOrMalformedId();
testCreatesNegotiatedChannelAndOffersIdUntilDecided();
testKeepsNegotiatedChannelWhenAnswerEchoesId();
testFallsBackToInBandChannelWithoutId();
testOnlyFirstAnswerDecides();
console.log('sessionDataChannelHarness: ok');
