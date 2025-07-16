import * as Ably from 'ably';
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

export class SignallingClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;
  private sessionId: string;
  private ablyToken: string;
  private channelName: string;
  private realtime: Ably.Realtime | null = null;
  private channel: Ably.RealtimeChannel | null = null;
  private stopSignal = false;
  private isConnected = false;

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

    // Initialize Ably Realtime client
    this.realtime = new Ably.Realtime(this.ablyToken);

    // Get the channel with hardcoded rewind parameter of 100
    this.channel = this.realtime.channels.get(this.channelName, {
      params: { rewind: '100' },
    });

    // Set up connection state listeners
    this.realtime.connection.on('connected', () => {
      this.onConnected();
    });

    this.realtime.connection.on('disconnected', () => {
      this.onDisconnected();
    });

    this.realtime.connection.on('failed', () => {
      this.onConnectionFailed();
    });

    // Subscribe to channel messages
    this.channel.subscribe((message) => {
      this.onMessage(message);
    });
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

    if (!this.isConnected) {
      throw new Error(
        'SignallingClient - sendSignalMessage: Cannot send message, connection not established yet.',
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
      this.isConnected = false;
    }
  }

  private onConnected(): void {
    try {
      this.isConnected = true;
      this.internalEventEmitter.emit(InternalEvent.WEB_SOCKET_OPEN);
    } catch (e) {
      console.error('SignallingClient - onConnected: error', e);
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        ConnectionClosedCode.SIGNALLING_CLIENT_CONNECTION_FAILURE,
      );
    }
  }

  private onDisconnected() {
    this.isConnected = false;
    if (this.stopSignal) {
      return;
    }
    // Ably handles reconnection automatically
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

  private onMessage(message: Ably.Message) {
    // Extract the SignalMessage from Ably message data
    const signalMessage: SignalMessage = message.data;
    this.internalEventEmitter.emit(
      InternalEvent.SIGNAL_MESSAGE_RECEIVED,
      signalMessage,
    );
  }
}
