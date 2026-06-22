import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InternalEventEmitter,
  PublicEventEmitter,
  StreamingClient,
} from '../src/modules';
import { ToolCallManager } from '../src/modules/ToolCallManager';
import { setClientMetricsDisabled } from '../src/lib/ClientMetrics';
import {
  AnamEvent,
  AudioPermissionState,
  InternalEvent,
  SignalMessageAction,
  StreamingClientOptions,
} from '../src/types';

class MockRTCPeerConnection {
  localDescription: RTCSessionDescription | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  onicecandidate:
    | ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => any)
    | null = null;
  oniceconnectionstatechange:
    | ((this: RTCPeerConnection, ev: Event) => any)
    | null = null;
  onconnectionstatechange:
    | ((this: RTCPeerConnection, ev: Event) => any)
    | null = null;

  createDataChannel = vi.fn(
    () =>
      ({
        onopen: null,
        onclose: null,
        onmessage: null,
        readyState: 'connecting',
        send: vi.fn(),
      }) as unknown as RTCDataChannel,
  );
  addEventListener = vi.fn();
  addTransceiver = vi.fn();
  createOffer = vi.fn(
    async () =>
      ({
        type: 'offer',
        sdp: 'v=0',
      }) as RTCSessionDescriptionInit,
  );
  setLocalDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      this.localDescription = description as RTCSessionDescription;
    },
  );
  getStats = vi.fn(async () => new Map() as unknown as RTCStatsReport);
  close = vi.fn(() => {
    this.connectionState = 'closed';
  });
  getSenders = vi.fn(() => []);
  addTrack = vi.fn();
}

const createStreamingClientOptions = (): StreamingClientOptions => ({
  engine: {
    baseUrl: 'https://engine.example.com',
  },
  signalling: {
    url: {
      baseUrl: 'signal.example.com',
      protocol: 'https',
    },
  },
  iceServers: [],
  supportsSessionConfig: true,
  inputAudio: {
    inputAudioState: {
      isMuted: false,
      permissionState: AudioPermissionState.NOT_REQUESTED,
    },
    disableInputAudio: false,
  },
});

describe('StreamingClient session config wait', () => {
  afterEach(() => {
    setClientMetricsDisabled(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not create a peer connection or send an offer when stopped during the wait', async () => {
    vi.useFakeTimers();
    setClientMetricsDisabled(true);

    const peerConnectionConstructor = vi.fn(() => new MockRTCPeerConnection());
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [],
      getAudioTracks: () => [],
    }));
    vi.stubGlobal('RTCPeerConnection', peerConnectionConstructor);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia,
      },
    });

    const publicEventEmitter = new PublicEventEmitter();
    const internalEventEmitter = new InternalEventEmitter();
    const client = new StreamingClient(
      'session-id',
      createStreamingClientOptions(),
      publicEventEmitter,
      internalEventEmitter,
      new ToolCallManager(publicEventEmitter, internalEventEmitter),
    );
    const sendOffer = vi.spyOn((client as any).signallingClient, 'sendOffer');

    internalEventEmitter.emit(InternalEvent.WEB_SOCKET_OPEN);
    await Promise.resolve();
    await client.stopConnection();
    await vi.advanceTimersByTimeAsync(1600);

    expect(client.getPeerConnection()).toBeNull();
    expect(peerConnectionConstructor).not.toHaveBeenCalled();
    expect(sendOffer).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('ignores connection-independent signals after shutdown', async () => {
    setClientMetricsDisabled(true);

    const publicEventEmitter = new PublicEventEmitter();
    const internalEventEmitter = new InternalEventEmitter();
    const connectionClosed = vi.fn();
    const serverWarning = vi.fn();
    const sessionReady = vi.fn();
    const talkStreamInterrupted = vi.fn();
    publicEventEmitter.addListener(
      AnamEvent.CONNECTION_CLOSED,
      connectionClosed,
    );
    publicEventEmitter.addListener(AnamEvent.SERVER_WARNING, serverWarning);
    publicEventEmitter.addListener(AnamEvent.SESSION_READY, sessionReady);
    publicEventEmitter.addListener(
      AnamEvent.TALK_STREAM_INTERRUPTED,
      talkStreamInterrupted,
    );

    const client = new StreamingClient(
      'stale-session-id',
      createStreamingClientOptions(),
      publicEventEmitter,
      internalEventEmitter,
      new ToolCallManager(publicEventEmitter, internalEventEmitter),
    );

    await client.stopConnection();
    internalEventEmitter.emit(InternalEvent.SIGNAL_MESSAGE_RECEIVED, {
      actionType: SignalMessageAction.END_SESSION,
      sessionId: 'later-session-id',
      payload: 'server ended',
    });
    internalEventEmitter.emit(InternalEvent.SIGNAL_MESSAGE_RECEIVED, {
      actionType: SignalMessageAction.WARNING,
      sessionId: 'later-session-id',
      payload: 'warning',
    });
    internalEventEmitter.emit(InternalEvent.SIGNAL_MESSAGE_RECEIVED, {
      actionType: SignalMessageAction.SESSION_READY,
      sessionId: 'later-session-id',
      payload: {},
    });
    internalEventEmitter.emit(InternalEvent.SIGNAL_MESSAGE_RECEIVED, {
      actionType: SignalMessageAction.TALK_STREAM_INTERRUPTED,
      sessionId: 'later-session-id',
      payload: { correlationId: 'later-correlation-id' },
    });

    expect(connectionClosed).not.toHaveBeenCalled();
    expect(serverWarning).not.toHaveBeenCalled();
    expect(sessionReady).not.toHaveBeenCalled();
    expect(talkStreamInterrupted).not.toHaveBeenCalled();
  });
});
