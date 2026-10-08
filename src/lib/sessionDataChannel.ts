// The "session" data channel is created pre-negotiated (negotiated: true) with this
// stream id, so a supporting server opens it as soon as SCTP is up instead of waiting
// for DATA_CHANNEL_OPEN. The id is sent with the offer.
export const NEGOTIATED_SESSION_DATA_CHANNEL_ID = 0;

const SESSION_DATA_CHANNEL_LABEL = 'session';

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

type DataChannelFactory = Pick<RTCPeerConnection, 'createDataChannel'>;

export interface ResolvedSessionDataChannel {
  channel: RTCDataChannel;
  negotiated: boolean;
}

/**
 * Owns the pre-negotiated session channel until the first answer decides whether
 * the server created its side. Later (ICE restart) answers find nothing pending.
 */
export class SessionDataChannelNegotiation {
  private pending: RTCDataChannel | null;

  constructor(private readonly peerConnection: DataChannelFactory) {
    this.pending = peerConnection.createDataChannel(
      SESSION_DATA_CHANNEL_LABEL,
      {
        ordered: true,
        negotiated: true,
        id: NEGOTIATED_SESSION_DATA_CHANNEL_ID,
      },
    );
  }

  // Sent with every offer until the first answer decides, since a restart offer
  // may be the first one the server sees.
  public offerId(): number | undefined {
    return this.pending ? NEGOTIATED_SESSION_DATA_CHANNEL_ID : undefined;
  }

  /**
   * Keeps the pre-negotiated channel if the answer echoes its id, and otherwise
   * replaces it with an in-band channel. Returns null once already decided.
   */
  public resolve(answer: unknown): ResolvedSessionDataChannel | null {
    const negotiatedChannel = this.pending;
    if (!negotiatedChannel) {
      return null;
    }
    this.pending = null;
    if (
      answerAcceptsNegotiatedSessionDataChannel(
        answer,
        NEGOTIATED_SESSION_DATA_CHANNEL_ID,
      )
    ) {
      return { channel: negotiatedChannel, negotiated: true };
    }
    // The offer already has the data m-line, so this needs no renegotiation.
    const inBandChannel = this.peerConnection.createDataChannel(
      SESSION_DATA_CHANNEL_LABEL,
      { ordered: true },
    );
    negotiatedChannel.close();
    return { channel: inBandChannel, negotiated: false };
  }
}
