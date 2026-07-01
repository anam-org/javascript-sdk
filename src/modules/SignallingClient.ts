import { InternalEventEmitter, PublicEventEmitter } from '.';
import { ClientConnectionMilestoneRecorder } from '../lib/ConnectionMilestones';
import {
  AnamEvent,
  InternalEvent,
  SignalMessage,
  SignalMessageAction,
  SignallingClientOptions,
  ConnectionClosedCode,
  ApiGatewayConfig,
  AgentAudioInputPayload,
} from '../types';
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
  private permanentlyClosed = false;
  private heartBeatIntervalRef: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private apiGatewayConfig: ApiGatewayConfig | undefined;
  private connectionMilestones: ClientConnectionMilestoneRecorder | undefined;

  constructor(
    sessionId: string,
    options: SignallingClientOptions,
    publicEventEmitter: PublicEventEmitter,
    internalEventEmitter: InternalEventEmitter,
    apiGatewayConfig?: ApiGatewayConfig,
    connectionMilestones?: ClientConnectionMilestoneRecorder,
  ) {
    this.publicEventEmitter = publicEventEmitter;
    this.internalEventEmitter = internalEventEmitter;
    this.apiGatewayConfig = apiGatewayConfig;
    this.connectionMilestones = connectionMilestones;

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

    // Construct WebSocket URL (with or without API Gateway)
    if (this.apiGatewayConfig?.enabled && this.apiGatewayConfig?.baseUrl) {
      // Use API Gateway WebSocket URL
      const gatewayUrl = new URL(this.apiGatewayConfig.baseUrl);
      const wsPath = this.apiGatewayConfig.wsPath ?? '/ws';

      // Construct gateway WebSocket URL
      gatewayUrl.protocol = gatewayUrl.protocol.replace('http', 'ws');
      gatewayUrl.pathname = wsPath;
      this.url = gatewayUrl;

      // Construct the complete target WebSocket URL and pass it as a query parameter
      const httpProtocol = url.protocol || 'https';
      const targetProtocol = httpProtocol === 'http' ? 'ws' : 'wss';
      const httpUrl = `${httpProtocol}://${url.baseUrl}`;
      const targetWsPath = url.signallingPath ?? '/ws';

      // Build complete target URL
      const targetUrl = new URL(httpUrl);
      targetUrl.protocol = targetProtocol === 'ws' ? 'ws:' : 'wss:';
      if (url.port) {
        targetUrl.port = url.port;
      }
      targetUrl.pathname = targetWsPath;
      targetUrl.searchParams.append('session_id', sessionId);

      // Pass complete target URL as query parameter
      this.url.searchParams.append('target_url', targetUrl.href);
    } else {
      // Direct connection to Anam (original behavior)
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
  }

  public stop() {
    this.stopSignal = true;
    this.closeSocket();
  }

  public connect(): WebSocket {
    this.clearReconnectTimer();
    this.connectionMilestones?.record('websocket_connecting', {
      attemptNumber: this.wsConnectionAttempts + 1,
    });
    this.socket = new WebSocket(this.url.href);
    this.socket.onopen = this.onOpen.bind(this);
    this.socket.onclose = this.onClose.bind(this);
    this.socket.onerror = this.onError.bind(this);
    return this.socket;
  }

  /**
   * Force a fresh signalling socket for an ICE restart. A network switch can
   * leave the existing socket half-open (readyState stays OPEN with no 'close'
   * event), so a restart offer sent on it is silently dropped. Detach the stale
   * socket's handlers so its eventual close does not drive the reconnect
   * backoff, drop it, and open a new connection — whose close/error events fire
   * normally, re-enabling the auto-reconnect loop until the new network path is
   * reachable.
   */
  public reconnectForIceRestart(): void {
    if (this.stopSignal || this.permanentlyClosed) {
      return;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      try {
        this.socket.close();
      } catch {
        // A half-open socket may throw on close; the reconnect proceeds regardless.
      }
      this.socket = null;
    }
    if (this.heartBeatIntervalRef) {
      clearInterval(this.heartBeatIntervalRef);
      this.heartBeatIntervalRef = null;
    }
    this.wsConnectionAttempts = 0;
    this.connect();
  }

  public isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  public isPermanentlyClosed(): boolean {
    return this.permanentlyClosed || this.stopSignal;
  }

  public async sendOffer(localDescription: RTCSessionDescription) {
    const offerMessagePayload = {
      connectionDescription: localDescription,
      userUid: this.sessionId, // TODO: this should be renamed to session ID on the server
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

  public async sendTalkMessage(payload: TalkMessageStreamPayload) {
    const chatMessage: SignalMessage = {
      actionType: SignalMessageAction.TALK_STREAM_INPUT,
      sessionId: this.sessionId,
      payload: payload,
    };
    this.sendSignalMessage(chatMessage);
  }

  public sendAgentAudioInput(payload: AgentAudioInputPayload): void {
    const message: SignalMessage = {
      actionType: SignalMessageAction.AGENT_AUDIO_INPUT,
      sessionId: this.sessionId,
      payload: payload,
    };
    this.sendSignalMessage(message);
  }

  public sendAgentAudioInputEnd(): void {
    const message: SignalMessage = {
      actionType: SignalMessageAction.AGENT_AUDIO_INPUT_END,
      sessionId: this.sessionId,
      payload: {},
    };
    this.sendSignalMessage(message);
  }

  private closeSocket() {
    this.clearReconnectTimer();
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
      this.connectionMilestones?.record('websocket_open', {
        attemptNumber: this.wsConnectionAttempts + 1,
      });
      this.wsConnectionAttempts = 0;
      this.flushSendingBuffer();
      this.socket.onmessage = this.onMessage.bind(this);
      this.startSendingHeartBeats();
      this.internalEventEmitter.emit(InternalEvent.WEB_SOCKET_OPEN);
    } catch (e) {
      console.error('SignallingClient - onOpen: error in onOpen', e);
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        ConnectionClosedCode.SIGNALLING_CLIENT_CONNECTION_FAILURE,
      );
      this.permanentlyClosed = true;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async onClose(event?: CloseEvent) {
    this.connectionMilestones?.record('websocket_closed', {
      attemptNumber: this.wsConnectionAttempts + 1,
      closeCode: event?.code,
      wasClean: event?.wasClean,
    });
    this.wsConnectionAttempts += 1;
    if (this.stopSignal) {
      return;
    }
    if (this.wsConnectionAttempts <= this.maxWsReconnectionAttempts) {
      const retryDelayMs = 100 * this.wsConnectionAttempts;
      this.connectionMilestones?.record('websocket_retry_scheduled', {
        attemptNumber: this.wsConnectionAttempts + 1,
        delayMs: retryDelayMs,
      });
      this.socket = null;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, retryDelayMs);
    } else {
      if (this.heartBeatIntervalRef) {
        clearInterval(this.heartBeatIntervalRef);
        this.heartBeatIntervalRef = null;
      }
      this.connectionMilestones?.publishFailure({
        failureStage: 'websocket',
        closeCode: event?.code,
      });
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        ConnectionClosedCode.SIGNALLING_CLIENT_CONNECTION_FAILURE,
      );
      this.permanentlyClosed = true;
    }
  }

  private onError(event: Event) {
    if (this.stopSignal) {
      return;
    }
    this.connectionMilestones?.record('websocket_error', {
      eventType: event.type,
    });
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
