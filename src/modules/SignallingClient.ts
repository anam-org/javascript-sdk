import { DEFAULT_ENGINE_BASE_URL } from '../lib/constants';
import {
  SignalMessage,
  SignalMessageAction,
  SignallingClientOptions,
} from '../types';

const DEFAULT_HEARTBEART_INTERVAL_SECONDS = 5;
const DEFAULT_WS_RECONNECTION_ATTEMPTS = 5;

export const DEFATULT_OPTIONS: SignallingClientOptions = {
  heartbeatIntervalSeconds: DEFAULT_HEARTBEART_INTERVAL_SECONDS,
  maxWsReconnectionAttempts: DEFAULT_WS_RECONNECTION_ATTEMPTS,
  url: {
    baseUrl: DEFAULT_ENGINE_BASE_URL,
    protocol: 'ws',
  },
};

export class SignallingClient {
  protected url: URL;
  protected sessionId: string;
  protected heartbeatIntervalSeconds: number;
  protected maxWsReconnectionAttempts: number;
  protected onSignalMessageReceivedCallback?: (
    msg: SignalMessage,
  ) => Promise<void> | void;
  protected onClientConnectedCallback?: () => Promise<void> | void;
  protected onClientConnectionFailureCallback?: () => Promise<void> | void;

  private stopSignal = false;
  private sendingBuffer: SignalMessage[] = [];
  private wsConnectionAttempts = 0;
  private socket: WebSocket | null = null;
  private heartBeatIntervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    sessionId: string,
    options: SignallingClientOptions = DEFATULT_OPTIONS,
    onSignalMessageReceivedCallback?: (
      msg: SignalMessage,
    ) => Promise<void> | void,
    onClientConnectedCallback?: () => Promise<void> | void,
    onClientConnectionFailureCallback?: () => Promise<void> | void,
  ) {
    if (!sessionId) {
      throw new Error('Signalling Client: sessionId is required');
    }
    this.sessionId = sessionId;

    if (onSignalMessageReceivedCallback) {
      this.onSignalMessageReceivedCallback = onSignalMessageReceivedCallback;
    }
    if (onClientConnectedCallback) {
      this.onClientConnectedCallback = onClientConnectedCallback;
    }
    if (onClientConnectionFailureCallback) {
      this.onClientConnectionFailureCallback =
        onClientConnectionFailureCallback;
    }
    const { heartbeatIntervalSeconds, maxWsReconnectionAttempts, url } =
      options;

    this.heartbeatIntervalSeconds =
      heartbeatIntervalSeconds || DEFAULT_HEARTBEART_INTERVAL_SECONDS;

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
      if (this.onClientConnectedCallback) {
        await this.onClientConnectedCallback();
      }
    } catch (e) {
      console.error('SignallingClient - onOpen: error in onOpen', e);
      if (this.onClientConnectionFailureCallback) {
        this.onClientConnectionFailureCallback();
      }
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
      if (this.onClientConnectionFailureCallback) {
        this.onClientConnectionFailureCallback();
      }
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
    const message = JSON.parse(event.data);
    if (this.onSignalMessageReceivedCallback) {
      await this.onSignalMessageReceivedCallback(message);
    }
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
