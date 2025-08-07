import { Realtime, RealtimeChannel, Message as AblyMessage } from 'ably';
import { InternalEventEmitter, PublicEventEmitter } from '.';
import {
  AnamEvent,
  InternalEvent,
  SignalMessage,
  SignalMessageAction,
  SignallingClientOptions,
  ConnectionClosedCode,
} from '../types';
import { TalkMessageStreamPayload } from '../types/signalling/TalkMessageStreamPayload';
import { toUnencodedMessage } from '../types/signalling/SignalMessage';

export class SignallingClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;
  private sessionId: string;
  private ablyToken: string;
  private channelName: string;
  private realtime: Realtime | null = null;
  private channel: RealtimeChannel | null = null;
  private stopSignal = false;

  constructor(
    sessionId: string,
    options: SignallingClientOptions,
    publicEventEmitter: PublicEventEmitter,
    internalEventEmitter: InternalEventEmitter,
  ) {
    this.publicEventEmitter = publicEventEmitter;
    this.internalEventEmitter = internalEventEmitter;

    if (!sessionId) {
      throw new Error('Signalling Client: sessionId is required');
    }
    this.sessionId = sessionId;

    const { ablyToken, channelName } = options;

    if (!ablyToken) {
      throw new Error('Signalling Client: ablyToken is required');
    }
    if (!channelName) {
      throw new Error('Signalling Client: channelName is required');
    }

    // Store configuration for later use in connect()
    this.ablyToken = ablyToken;
    this.channelName = channelName;
  }

  public stop() {
    this.stopSignal = true;
    this.closeConnection();
  }

  public connect(): void {
    // Check if already connected
    if (this.realtime) {
      console.warn('SignallingClient - connect: Already connected');
      return;
    }

    // Initialize Ably Realtime client with echo disabled
    this.realtime = new Realtime({
      token: this.ablyToken,
      echoMessages: false,
      disconnectedRetryTimeout: 1000, // Retry after 1 second
      suspendedRetryTimeout: 2000, // Retry after 2 seconds if suspended (this comes after repeated disconnection and failed reconnects)
      transportParams: {
        heartbeatInterval: 5000, // this is the minimum heartbeat interval, we want it low so we can quickly detect disconnections.
      },
    });

    // Get the channel with hardcoded rewind parameter of 100
    this.channel = this.realtime.channels.get(this.channelName, {
      params: { rewind: '100' },
    });

    this.channel.presence.enter();

    // Set up connection state listeners
    this.realtime.connection.on('connected', () => {
      this.onConnected();
    });

    this.realtime.connection.on('failed', () => {
      this.onConnectionFailed();
    });

    // Subscribe to channel messages
    this.channel.subscribe((message) => {
      this.onMessage(message);
    });
    this.realtime.connect();
  }

  public async sendOffer(localDescription: RTCSessionDescription) {
    if (!this.channel) {
      throw new Error(
        'SignallingClient - sendOffer: Not connected. Call connect() first.',
      );
    }

    const offerMessagePayload = {
      connectionDescription: localDescription,
      userUid: this.sessionId,
    };
    const offerMessage: SignalMessage = {
      actionType: SignalMessageAction.OFFER,
      sessionId: this.sessionId,
      payload: offerMessagePayload,
    };
    this.sendSignalMessage(offerMessage);
  }

  public async sendIceCandidate(candidate: RTCIceCandidate) {
    if (!this.channel) {
      throw new Error(
        'SignallingClient - sendIceCandidate: Not connected. Call connect() first.',
      );
    }

    const iceCandidateMessage: SignalMessage = {
      actionType: SignalMessageAction.ICE_CANDIDATE,
      sessionId: this.sessionId,
      payload: candidate.toJSON(),
    };
    this.sendSignalMessage(iceCandidateMessage);
  }

  private sendSignalMessage(message: SignalMessage) {
    if (!this.channel) {
      throw new Error(
        'SignallingClient - sendSignalMessage: Cannot send message, not connected. Call connect() first.',
      );
    }

    try {
      this.channel.publish('signal', message);
    } catch (error) {
      console.error(
        'SignallingClient - sendSignalMessage: error sending message',
        error,
      );
      throw error;
    }
  }

  public async sendTalkMessage(payload: TalkMessageStreamPayload) {
    if (!this.channel) {
      throw new Error(
        'SignallingClient - sendTalkMessage: Not connected. Call connect() first.',
      );
    }

    const chatMessage: SignalMessage = {
      actionType: SignalMessageAction.TALK_STREAM_INPUT,
      sessionId: this.sessionId,
      payload: payload,
    };
    this.sendSignalMessage(chatMessage);
  }

  private closeConnection() {
    if (this.realtime) {
      this.realtime.close();
      this.realtime = null;
      this.channel = null;
    }
  }

  private onConnected(): void {
    try {
      this.internalEventEmitter.emit(InternalEvent.WEB_SOCKET_OPEN);
    } catch (e) {
      console.error('SignallingClient - onConnected: error', e);
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        ConnectionClosedCode.SIGNALLING_CLIENT_CONNECTION_FAILURE,
      );
    }
  }

  private onConnectionFailed() {
    if (this.stopSignal) {
      return;
    }
    this.publicEventEmitter.emit(
      AnamEvent.CONNECTION_CLOSED,
      ConnectionClosedCode.SIGNALLING_CLIENT_CONNECTION_FAILURE,
    );
  }

  private onMessage(message: AblyMessage) {
    // Extract the SignalMessage from Ably message data
    let signalMessage: SignalMessage = message.data;
    // Messages coming back from the server may have an encoded payload, convert it to unencoded for cosumption elsewhere in the SDK
    signalMessage = toUnencodedMessage(signalMessage);
    this.internalEventEmitter.emit(
      InternalEvent.SIGNAL_MESSAGE_RECEIVED,
      signalMessage,
    );
  }
}
