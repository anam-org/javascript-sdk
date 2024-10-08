import { PUBLIC_MESSAGE_ON_SIGNALLING_CLIENT_CONNECTION_FAILURE } from '../lib/constants';
import {
  AnamEvent,
  InternalEvent,
  SignalMessage,
  SignalMessageAction,
  SignallingClientOptions,
} from '../types';
import { PublicEventEmitter, InternalEventEmitter } from '../modules';
import { TalkMessageStreamPayload } from '../types/signalling/TalkMessageStreamPayload';

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 5;
const DEFAULT_WS_RECONNECTION_ATTEMPTS = 5;

export class SignallingClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;
  private url: URL;
  private sessionId: string;
  private heartbeatIntervalSeconds: number;
  private maxWsReconnectionAttempts: number;
  private stopSignal = false;
  private sendingBuffer: SignalMessage[] = [];
  private wsConnectionAttempts = 0;
  private socket: WebSocket | null = null;
  private heartBeatIntervalRef: ReturnType<typeof setInterval> | null = null;

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

    const { heartbeatIntervalSeconds, maxWsReconnectionAttempts, url } =
      options;

    this.heartbeatIntervalSeconds =
      heartbeatIntervalSeconds || DEFAULT_HEARTBEAT_INTERVAL_SECONDS;

    this.maxWsReconnectionAttempts =
      maxWsReconnectionAttempts || DEFAULT_WS_RECONNECTION_ATTEMPTS;

    if (!url.baseUrl) {
      throw new Error('Signalling Client: baseUrl is required');
    }
    const httpProtocol = url.protocol || 'https';
    const initUrl = `${httpProtocol}://${url.baseUrl}`;
    this.url = new URL(initUrl);
    this.url.protocol = url.protocol === 'http' ? 'ws:' : 'wss:';
    if (url.port) {
      this.url.port = url.port;
    }
    this.url.pathname = url.signallingPath ?? '/ws';
    this.url.searchParams.append('session_id', sessionId);
  }

  public stop() {
    this.stopSignal = true;
    this.closeSocket();
  }

  public connect(): WebSocket {
    this.socket = new WebSocket(this.url.href);
    this.socket.onopen = this.onOpen.bind(this);
    this.socket.onclose = this.onClose.bind(this);
    this.socket.onerror = this.onError.bind(this);
    return this.socket;
  }

  public async sendOffer(localDescription: RTCSessionDescription) {
    const offerMessagePayload = {
      connectionDescription: localDescription,
      userUid: this.sessionId, // TODO: this should be renamed to session Id on the server
    };
    const offerMessage: SignalMessage = {
      actionType: SignalMessageAction.OFFER,
      sessionId: this.sessionId,
      payload: offerMessagePayload,
    };
    this.sendSignalMessage(offerMessage);
  }

  public async sendIceCandidate(candidate: RTCIceCandidate) {
    const iceCandidateMessage: SignalMessage = {
      actionType: SignalMessageAction.ICE_CANDIDATE,
      sessionId: this.sessionId,
      payload: candidate.toJSON(),
    };
    this.sendSignalMessage(iceCandidateMessage);
  }

  private sendSignalMessage(message: SignalMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        console.error(
          'SignallingClient - sendSignalMessage: error sending message',
          error,
        );
      }
    } else {
      this.sendingBuffer.push(message);
    }
  }

  public async sendChatMessage(payload: TalkMessageStreamPayload) {
    const chatMessage: SignalMessage = {
      actionType: SignalMessageAction.TALK_STREAM_INPUT,
      sessionId: this.sessionId,
      payload: payload,
    };
    this.sendSignalMessage(chatMessage);
  }

  private closeSocket() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.heartBeatIntervalRef) {
      clearInterval(this.heartBeatIntervalRef);
      this.heartBeatIntervalRef = null;
    }
  }

  private async onOpen(): Promise<void> {
    if (!this.socket) {
      throw new Error('SignallingClient - onOpen: socket is null');
    }
    try {
      this.wsConnectionAttempts = 0;
      this.flushSendingBuffer();
      this.socket.onmessage = this.onMessage.bind(this);
      this.startSendingHeartBeats();
      this.internalEventEmitter.emit(InternalEvent.WEB_SOCKET_OPEN);
    } catch (e) {
      console.error('SignallingClient - onOpen: error in onOpen', e);
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        PUBLIC_MESSAGE_ON_SIGNALLING_CLIENT_CONNECTION_FAILURE,
      );
    }
  }

  private async onClose() {
    this.wsConnectionAttempts += 1;
    if (this.stopSignal) {
      return;
    }
    if (this.wsConnectionAttempts <= this.maxWsReconnectionAttempts) {
      this.socket = null;
      setTimeout(() => {
        this.connect();
      }, 100 * this.wsConnectionAttempts);
    } else {
      if (this.heartBeatIntervalRef) {
        clearInterval(this.heartBeatIntervalRef);
        this.heartBeatIntervalRef = null;
      }
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        PUBLIC_MESSAGE_ON_SIGNALLING_CLIENT_CONNECTION_FAILURE,
      );
    }
  }

  private onError(event: Event) {
    if (this.stopSignal) {
      return;
    }
    console.error('SignallingClient - onError: ', event);
  }

  private flushSendingBuffer() {
    const newBuffer: SignalMessage[] = [];
    if (this.sendingBuffer.length > 0) {
      this.sendingBuffer.forEach((message: SignalMessage) => {
        if (this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify(message));
        } else {
          newBuffer.push(message);
        }
      });
    }
    this.sendingBuffer = newBuffer;
  }

  private async onMessage(event: MessageEvent) {
    const message: SignalMessage = JSON.parse(event.data);
    this.internalEventEmitter.emit(
      InternalEvent.SIGNAL_MESSAGE_RECEIVED,
      message,
    );
  }

  private startSendingHeartBeats() {
    if (!this.socket) {
      throw new Error(
        'SignallingClient - startSendingHeartBeats: socket is null',
      );
    }
    if (this.heartBeatIntervalRef) {
      console.warn(
        'SignallingClient - startSendingHeartBeats: heartbeat interval already set',
      );
    }
    // send a heartbeat message every heartbeatIntervalSeconds
    const heartbeatInterval = this.heartbeatIntervalSeconds * 1000;
    const heartbeatMessage: SignalMessage = {
      actionType: SignalMessageAction.HEARTBEAT,
      sessionId: this.sessionId,
      payload: '',
    };
    const heartbeatMessageJson = JSON.stringify(heartbeatMessage);
    this.heartBeatIntervalRef = setInterval(() => {
      if (this.stopSignal) {
        return;
      }
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(heartbeatMessageJson);
      }
    }, heartbeatInterval);
  }
}
