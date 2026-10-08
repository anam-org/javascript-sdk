// The "session" data channel is created pre-negotiated (negotiated: true) with this
// stream id, so a supporting server opens it as soon as SCTP is up instead of waiting
// for DATA_CHANNEL_OPEN. The id is sent with the offer.
export const NEGOTIATED_SESSION_DATA_CHANNEL_ID = 0;

// The server echoes the id in the answer when it created its side of the channel.
// Without it (older server or feature flag off) the client opens the channel in-band.
export const answerAcceptsNegotiatedSessionDataChannel = (
  answer: unknown,
  id: number,
): boolean =>
  typeof answer === 'object' &&
  answer !== null &&
  (answer as { negotiatedSessionDataChannelId?: unknown })
    .negotiatedSessionDataChannelId === id;
