import {
  ClientMetricMeasurement,
  createRTCStatsReport,
  sendClientMetric,
} from '../lib/ClientMetrics';
import { ClientConnectionMilestoneRecorder } from '../lib/ConnectionMilestones';
import {
  EngineApiRestClient,
  InternalEventEmitter,
  PublicEventEmitter,
  SignallingClient,
} from '../modules';
import {
  AnamEvent,
  ApiGatewayConfig,
  AgentAudioInputConfig,
  AudioPermissionState,
  ConnectionClosedCode,
  DataChannelMessage,
  InputAudioState,
  InternalEvent,
  SignalMessage,
  SignalMessageAction,
  StreamingClientOptions,
  WebRtcClientToolEvent,
  WebRtcTextMessageEvent,
  WebRtcReasoningTextMessageEvent,
} from '../types';
import { AgentAudioInputStream } from '../types/AgentAudioInputStream';
import { ToolCallResultReceivedPayload } from '../types/toolCalling/ToolCallPayload';
import { TalkMessageStream } from '../types/TalkMessageStream';
import { TalkStreamInterruptedSignalMessage } from '../types/signalling/TalkStreamInterruptedSignalMessage';
import {
  WebRtcToolCallCompletedEvent,
  WebRtcToolCallFailedEvent,
  WebRtcToolCallStartedEvent,
} from '../types/streaming/WebRtcToolCallEvent';
import { ToolCallManager } from './ToolCallManager';

const SUCCESS_METRIC_POLLING_TIMEOUT_MS = 15000; // After this time we will stop polling for the first frame and consider the session a failure.
const STATS_COLLECTION_INTERVAL_MS = 5000;
const ICE_CANDIDATE_POOL_SIZE = 2; // Optimisation to speed up connection time
const MAX_ICE_RESTART_ATTEMPTS = 3;
const ICE_DISCONNECTED_GRACE_MS = 2000;
const ICE_RESTART_WATCHDOG_MS = 3000;
const ENSURE_WS_OPEN_TIMEOUT_MS = 5000;

export class StreamingClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;
  private signallingClient: SignallingClient;
  private engineApiRestClient: EngineApiRestClient;
  private iceServers: RTCIceServer[];
  private iceTransportPolicy: RTCIceTransportPolicy | undefined;
  private rtcConfiguration: RTCConfiguration | undefined;
  private apiGatewayConfig: ApiGatewayConfig | undefined;
  private peerConnection: RTCPeerConnection | null = null;
  private connectionEstablishedEmitted = false;
  private iceRestartInProgress = false;
  private iceRestartAttempts = 0;
  private iceRestartAwaitedAnswer = false;
  private iceRestartStopped = false; // set on shutdown; halts all restart activity
  private iceDisconnectedGraceTimer: ReturnType<typeof setTimeout> | null =
    null;
  private iceRestartWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWsOpenListener: (() => void) | null = null;
  private pendingWsOpenTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingWsOpenReject: ((reason?: unknown) => void) | null = null;
  private connectionReceivedAnswer = false;
  private remoteIceCandidateBuffer: RTCIceCandidate[] = [];

  // While a re-offer is being minted and sent, local candidates are buffered here
  // so they reach the server AFTER the restart offer (which carries the new ICE
  // credentials); otherwise the engine adds them against the old generation and
  // drops them. null = not buffering (normal path).
  private iceRestartCandidateBuffer: RTCIceCandidate[] | null = null;
  private inputAudioStream: MediaStream | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private videoStream: MediaStream | null = null;
  private audioStream: MediaStream | null = null;
  private inputAudioState: InputAudioState = {
    isMuted: false,
    permissionState: AudioPermissionState.NOT_REQUESTED,
  };
  private audioDeviceId: string | undefined;
  private disableInputAudio: boolean;
  private successMetricPoller: ReturnType<typeof setInterval> | null = null;
  private successMetricFired = false;
  private showPeerConnectionStatsReport: boolean = false;
  private peerConnectionStatsReportOutputFormat: 'console' | 'json' = 'console';
  private statsCollectionInterval: ReturnType<typeof setInterval> | null = null;
  private agentAudioInputStream: AgentAudioInputStream | null = null;
  private toolCallManager: ToolCallManager;
  private connectionMilestones: ClientConnectionMilestoneRecorder | undefined;
  private firstLocalIceCandidateSent = false;
  private firstRemoteIceCandidateReceived = false;
  private firstRemoteIceCandidateApplied = false;
  private connectionEstablishedMilestoneRecorded = false;

  constructor(
    sessionId: string,
    options: StreamingClientOptions,
    publicEventEmitter: PublicEventEmitter,
    internalEventEmitter: InternalEventEmitter,
    toolCallManager: ToolCallManager,
    connectionMilestones?: ClientConnectionMilestoneRecorder,
  ) {
    this.publicEventEmitter = publicEventEmitter;
    this.internalEventEmitter = internalEventEmitter;
    this.toolCallManager = toolCallManager;
    this.connectionMilestones = connectionMilestones;
    this.apiGatewayConfig = options.apiGateway;
    // initialize input audio state
    const { inputAudio } = options;
    this.inputAudioState = inputAudio.inputAudioState;
    if (options.inputAudio.userProvidedMediaStream) {
      this.inputAudioStream = options.inputAudio.userProvidedMediaStream;
    }
    this.disableInputAudio = options.inputAudio.disableInputAudio === true;
    // register event handlers
    this.internalEventEmitter.addListener(
      InternalEvent.WEB_SOCKET_OPEN,
      this.onSignallingClientConnected.bind(this),
    );
    this.internalEventEmitter.addListener(
      InternalEvent.SIGNAL_MESSAGE_RECEIVED,
      this.onSignalMessage.bind(this),
    );
    this.internalEventEmitter.addListener(
      InternalEvent.WEBRTC_TOOL_CALL_STARTED_EVENT_RECEIVED,
      this.toolCallManager.processToolCallStartedEvent.bind(
        this.toolCallManager,
      ),
    );
    this.internalEventEmitter.addListener(
      InternalEvent.WEBRTC_TOOL_CALL_COMPLETED_EVENT_RECEIVED,
      this.toolCallManager.processToolCallCompletedEvent.bind(
        this.toolCallManager,
      ),
    );
    this.internalEventEmitter.addListener(
      InternalEvent.WEBRTC_TOOL_CALL_FAILED_EVENT_RECEIVED,
      this.toolCallManager.processToolCallFailedEvent.bind(
        this.toolCallManager,
      ),
    );
    this.internalEventEmitter.addListener(
      InternalEvent.TOOL_CALL_RESULT_READY,
      this.onToolCallResultReceived.bind(this),
    );
    // set ice servers
    this.iceServers = options.iceServers;
    this.iceTransportPolicy = options.iceTransportPolicy;
    this.rtcConfiguration = options.rtcConfiguration;
    // initialize signalling client
    this.signallingClient = new SignallingClient(
      sessionId,
      options.signalling,
      this.publicEventEmitter,
      this.internalEventEmitter,
      this.apiGatewayConfig,
      this.connectionMilestones,
    );
    // initialize engine API client
    this.engineApiRestClient = new EngineApiRestClient(
      options.engine.baseUrl,
      sessionId,
      this.apiGatewayConfig,
    );
    this.audioDeviceId = options.inputAudio.audioDeviceId;
    this.showPeerConnectionStatsReport =
      options.metrics?.showPeerConnectionStatsReport ?? false;
    this.peerConnectionStatsReportOutputFormat =
      options.metrics?.peerConnectionStatsReportOutputFormat ?? 'console';
  }

  private onInputAudioStateChange(
    oldState: InputAudioState,
    newState: InputAudioState,
  ) {
    // changed microphone mute state
    if (oldState.isMuted !== newState.isMuted) {
      if (newState.isMuted) {
        this.muteAllAudioTracks();
      } else {
        this.unmuteAllAudioTracks();
      }
    }
  }

  private muteAllAudioTracks() {
    this.inputAudioStream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  }

  private unmuteAllAudioTracks() {
    this.inputAudioStream?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
  }

  private startStatsCollection() {
    if (this.statsCollectionInterval) {
      return;
    }

    // Send stats every STATS_COLLECTION_INTERVAL_MS seconds
    this.statsCollectionInterval = setInterval(async () => {
      if (
        !this.peerConnection ||
        !this.dataChannel ||
        this.dataChannel.readyState !== 'open'
      ) {
        return;
      }

      try {
        const stats = await this.peerConnection.getStats();
        this.sendClientSideMetrics(stats);
      } catch (error) {
        console.error('Failed to collect and send stats:', error);
      }
    }, STATS_COLLECTION_INTERVAL_MS);
  }

  private sendClientSideMetrics(stats: RTCStatsReport) {
    stats.forEach((report: RTCStats) => {
      // Process inbound-rtp stats for both video and audio
      if (report.type === 'inbound-rtp') {
        const metrics = {
          message_type: 'remote_rtp_stats',
          data: report,
        };

        // Send the metrics via data channel
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          this.dataChannel.send(JSON.stringify(metrics));
        }
      }
    });
  }

  private recordSessionSuccess(detectionMethod: string) {
    if (this.successMetricFired) {
      return;
    }

    this.successMetricFired = true;
    this.connectionMilestones?.record('first_video_frame', {
      detectionMethod,
    });
    this.connectionMilestones?.recordSessionSuccess({ detectionMethod });
    sendClientMetric(
      ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_SESSION_SUCCESS,
      '1',
      { detectionMethod },
    );
  }

  private startSuccessMetricPolling() {
    if (this.successMetricPoller || this.successMetricFired) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (this.successMetricPoller) {
        this.connectionMilestones?.record('first_video_frame_timeout', {
          timeoutMs: SUCCESS_METRIC_POLLING_TIMEOUT_MS,
        });
        this.connectionMilestones?.publishFailure({
          failureStage: 'first_video_frame',
          timeoutMs: SUCCESS_METRIC_POLLING_TIMEOUT_MS,
        });
        console.warn(
          'No video frames received, there is a problem with the connection.',
        );
        clearInterval(this.successMetricPoller);
        this.successMetricPoller = null;
      }
    }, SUCCESS_METRIC_POLLING_TIMEOUT_MS);

    this.successMetricPoller = setInterval(async () => {
      if (!this.peerConnection || this.successMetricFired) {
        if (this.successMetricPoller) {
          clearInterval(this.successMetricPoller);
        }
        clearTimeout(timeoutId);
        return;
      }

      try {
        const stats = await this.peerConnection.getStats();

        let videoDetected = false;
        let detectionMethod = null;

        stats.forEach((report) => {
          // Find the report for inbound video
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            // Method 1: Try framesDecoded (most reliable when available)
            if (
              report.framesDecoded !== undefined &&
              report.framesDecoded > 0
            ) {
              videoDetected = true;
              detectionMethod = 'framesDecoded';
            } else if (
              report.framesReceived !== undefined &&
              report.framesReceived > 0
            ) {
              videoDetected = true;
              detectionMethod = 'framesReceived';
            } else if (
              report.bytesReceived > 0 &&
              report.packetsReceived > 0 &&
              // Additional check: ensure we've received enough data for actual video
              report.bytesReceived > 100000 // rough threshold
            ) {
              videoDetected = true;
              detectionMethod = 'bytesReceived';
            }
          }
        });
        if (videoDetected && !this.successMetricFired) {
          this.recordSessionSuccess(detectionMethod ?? 'unknown');
          if (this.successMetricPoller) {
            clearInterval(this.successMetricPoller);
          }
          clearTimeout(timeoutId);
          this.successMetricPoller = null;
        }
      } catch (error) {}
    }, 500);
  }

  public muteInputAudio(): InputAudioState {
    const oldAudioState: InputAudioState = this.inputAudioState;
    const newAudioState: InputAudioState = {
      ...this.inputAudioState,
      isMuted: true,
    };
    this.inputAudioState = newAudioState;
    this.onInputAudioStateChange(oldAudioState, newAudioState);
    return this.inputAudioState;
  }

  public unmuteInputAudio(): InputAudioState {
    const oldAudioState: InputAudioState = this.inputAudioState;
    const newAudioState: InputAudioState = {
      ...this.inputAudioState,
      isMuted: false,
    };
    this.inputAudioState = newAudioState;
    this.onInputAudioStateChange(oldAudioState, newAudioState);
    return this.inputAudioState;
  }

  public getInputAudioState(): InputAudioState {
    return this.inputAudioState;
  }

  public getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection;
  }

  public async changeAudioInputDevice(deviceId: string): Promise<void> {
    if (!this.peerConnection) {
      throw new Error(
        'StreamingClient - changeAudioInputDevice: peer connection is not initialized. Start streaming first.',
      );
    }

    if (deviceId === null || deviceId === undefined) {
      throw new Error(
        'StreamingClient - changeAudioInputDevice: deviceId is required',
      );
    }

    // Store the current mute state to preserve it
    const wasMuted = this.inputAudioState.isMuted;

    try {
      // Stop the current audio stream tracks
      if (this.inputAudioStream) {
        this.inputAudioStream.getAudioTracks().forEach((track) => {
          track.stop();
        });
      }

      // Request new audio stream with the new device ID
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        deviceId: {
          exact: deviceId,
        },
      };

      this.inputAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      // Update the stored device ID
      this.audioDeviceId = deviceId;

      // Replace the audio track in the peer connection
      await this.setupAudioTrack();

      // Restore the mute state
      if (wasMuted) {
        this.muteAllAudioTracks();
      }

      // Emit event to notify that the device has changed
      this.publicEventEmitter.emit(
        AnamEvent.INPUT_AUDIO_DEVICE_CHANGED,
        deviceId,
      );
    } catch (error) {
      console.error('Failed to change audio input device:', error);
      throw new Error(
        `StreamingClient - changeAudioInputDevice: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public getInputAudioStream(): MediaStream | null {
    return this.inputAudioStream;
  }

  public getVideoStream(): MediaStream | null {
    return this.videoStream;
  }

  public getAudioStream(): MediaStream | null {
    return this.audioStream;
  }

  private onToolCallResultReceived(
    payload: ToolCallResultReceivedPayload,
  ): void {
    const message: Record<string, string> = {
      session_id: payload.sessionId,
      message_type: 'tool_result',
      tool_call_id: payload.toolCallId,
      user_action_correlation_id: payload.userActionCorrelationId,
      timestamp_user_action: payload.timestampUserAction,
    };

    if (payload.result !== undefined) {
      message.result = payload.result;
    }

    if (payload.errorMessage) {
      message.error = payload.errorMessage;
    }

    this.sendDataMessage(JSON.stringify(message));
  }

  public sendDataMessage(message: string) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(message);
    }
  }

  public setMediaStreamTargetById(videoElementId: string) {
    // set up streaming targets
    if (videoElementId) {
      const videoElement = document.getElementById(videoElementId);
      if (!videoElement) {
        throw new Error(
          `StreamingClient: video element with id ${videoElementId} not found`,
        );
      }
      this.videoElement = videoElement as HTMLVideoElement;
    }
  }

  public startConnection() {
    try {
      if (this.peerConnection) {
        console.error(
          'StreamingClient - startConnection: peer connection already exists',
        );
        return;
      }
      this.resetAttemptScopedMilestoneState();
      this.connectionMilestones?.record('connection_start_requested');
      // start the connection
      this.signallingClient.connect();
    } catch (error) {
      console.error('StreamingClient - startConnection: error', error);
      this.handleWebrtcFailure(error);
    }
  }

  private resetAttemptScopedMilestoneState() {
    this.firstLocalIceCandidateSent = false;
    this.firstRemoteIceCandidateReceived = false;
    this.firstRemoteIceCandidateApplied = false;
    this.connectionEstablishedMilestoneRecorded = false;
  }

  public async stopConnection() {
    await this.shutdown();
  }

  public async sendTalkCommand(content: string): Promise<void> {
    if (!this.peerConnection) {
      throw new Error(
        'StreamingClient - sendTalkCommand: peer connection is null',
      );
    }
    await this.engineApiRestClient.sendTalkCommand(content);
    return;
  }

  public startTalkMessageStream(correlationId?: string): TalkMessageStream {
    if (!correlationId) {
      // generate a random correlation uuid
      correlationId = Math.random().toString(36).substring(2, 15);
    }
    return new TalkMessageStream(
      correlationId,
      this.internalEventEmitter,
      this.signallingClient,
    );
  }

  public createAgentAudioInputStream(
    config: AgentAudioInputConfig,
  ): AgentAudioInputStream {
    this.agentAudioInputStream = new AgentAudioInputStream(
      config,
      this.signallingClient,
    );
    return this.agentAudioInputStream;
  }

  public getAgentAudioInputStream(): AgentAudioInputStream | null {
    return this.agentAudioInputStream;
  }

  private async initPeerConnection() {
    this.connectionMilestones?.record('peer_connection_creating');
    this.peerConnection = new RTCPeerConnection({
      // SDK default first (caller's rtcConfiguration may override it)
      iceCandidatePoolSize: ICE_CANDIDATE_POOL_SIZE,
      // caller's full RTCConfiguration passthrough (e.g. iceTransportPolicy: 'relay')
      ...this.rtcConfiguration,
      iceTransportPolicy:
        this.rtcConfiguration?.iceTransportPolicy ??
        this.iceTransportPolicy ??
        undefined,
      // resolved iceServers always wins for its field (preserves backward compat)
      iceServers: this.iceServers,
    });
    this.connectionMilestones?.record('peer_connection_created', {
      iceCandidatePoolSize: ICE_CANDIDATE_POOL_SIZE,
      iceServerCount: this.iceServers.length,
      iceTransportPolicy:
        this.rtcConfiguration?.iceTransportPolicy ??
        this.iceTransportPolicy ??
        'all',
    });
    // set event handlers
    this.peerConnection.onicecandidate = this.onIceCandidate.bind(this);
    this.peerConnection.oniceconnectionstatechange =
      this.onIceConnectionStateChange.bind(this);
    this.peerConnection.onconnectionstatechange =
      this.onConnectionStateChange.bind(this);
    this.peerConnection.addEventListener(
      'track',
      this.onTrackEventHandler.bind(this),
    );

    // set up data channels
    await this.setupDataChannels();

    // add transceivers
    this.peerConnection.addTransceiver('video', { direction: 'recvonly' });
    if (this.disableInputAudio) {
      this.connectionMilestones?.record('microphone_permission_skipped', {
        reason: 'input_audio_disabled',
      });
      this.peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    } else {
      this.peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

      // Handle audio setup after transceivers are configured
      if (this.inputAudioStream) {
        this.connectionMilestones?.record('input_audio_stream_provided', {
          audioTrackCount: this.inputAudioStream.getAudioTracks().length,
        });
        // User provided an audio stream, set it up immediately
        await this.setupAudioTrack();
      } else {
        // No user stream, start microphone permission request asynchronously
        // Don't await - let it run in parallel with connection setup
        this.requestMicrophonePermissionAsync().catch((error) => {
          console.error('Async microphone permission request failed:', error);
        });
      }
    }
  }

  private async onSignalMessage(signalMessage: SignalMessage) {
    if (!this.peerConnection) {
      console.error(
        'StreamingClient - onSignalMessage: peerConnection is not initialized',
      );
      return;
    }
    switch (signalMessage.actionType) {
      case SignalMessageAction.ANSWER: {
        this.connectionMilestones?.record('answer_received');
        const answer = signalMessage.payload as RTCSessionDescriptionInit;
        if (this.peerConnection.signalingState !== 'have-local-offer') {
          // Late answer to a superseded / rolled-back restart offer — ignore it so
          // it cannot be applied in a stable state or against a different offer.
          break;
        }
        try {
          await this.peerConnection.setRemoteDescription(answer);
        } catch (err) {
          console.error(
            'StreamingClient - setRemoteDescription(answer) failed',
            err,
          );
          break; // let the ICE restart watchdog retry
        }
        this.connectionMilestones?.record('remote_description_set');
        this.connectionReceivedAnswer = true;
        // flush the remote buffer
        await this.flushRemoteIceCandidateBuffer();
        break;
      }
      case SignalMessageAction.ICE_CANDIDATE: {
        const iceCandidateConfig = signalMessage.payload as RTCIceCandidateInit;
        const candidate = new RTCIceCandidate(iceCandidateConfig);
        if (!this.firstRemoteIceCandidateReceived) {
          this.firstRemoteIceCandidateReceived = true;
          this.connectionMilestones?.record(
            'first_remote_ice_candidate_received',
            getIceCandidateMilestoneTags(candidate),
          );
        }
        if (this.connectionReceivedAnswer) {
          await this.addRemoteIceCandidate(candidate);
        } else {
          this.remoteIceCandidateBuffer.push(candidate);
        }
        break;
      }
      case SignalMessageAction.END_SESSION:
        const reason = signalMessage.payload as string;
        this.connectionMilestones?.publishFailure({
          failureStage: 'server_closed_connection',
        });
        this.publicEventEmitter.emit(
          AnamEvent.CONNECTION_CLOSED,
          ConnectionClosedCode.SERVER_CLOSED_CONNECTION,
          reason,
        );
        // close the peer connection
        this.shutdown();
        break;
      case SignalMessageAction.WARNING:
        const message = signalMessage.payload as string;
        console.warn('Warning received from server: ' + message);
        this.publicEventEmitter.emit(AnamEvent.SERVER_WARNING, message);
        break;
      case SignalMessageAction.TALK_STREAM_INTERRUPTED:
        const chatMessage =
          signalMessage.payload as TalkStreamInterruptedSignalMessage;
        this.publicEventEmitter.emit(
          AnamEvent.TALK_STREAM_INTERRUPTED,
          chatMessage.correlationId,
        );
        break;
      case SignalMessageAction.SESSION_READY:
        const sessionId = signalMessage.sessionId as string;
        this.publicEventEmitter.emit(AnamEvent.SESSION_READY, sessionId);
        break;
      case SignalMessageAction.HEARTBEAT:
        break;
      default:
        console.warn(
          'StreamingClient - onSignalMessage: unknown signal message action type. Is your @anam-ai/js-sdk version up to date?',
          signalMessage,
        );
    }
  }

  private async onSignallingClientConnected() {
    if (!this.peerConnection) {
      try {
        await this.initPeerConnectionAndSendOffer();
      } catch (err) {
        console.error(
          'StreamingClient - onSignallingClientConnected: Error initializing peer connection',
          err,
        );
        this.handleWebrtcFailure(err);
      }
    }
  }

  private async flushRemoteIceCandidateBuffer() {
    const bufferedCandidates = [...this.remoteIceCandidateBuffer];
    this.remoteIceCandidateBuffer = [];
    for (const candidate of bufferedCandidates) {
      await this.addRemoteIceCandidate(candidate);
    }
  }

  /**
   * Add a single remote ICE candidate to the peer connection.
   * Each candidate is added independently: a rejection on one candidate is
   * logged and swallowed so it cannot abort the flush loop (dropping the
   * remaining buffered candidates) or surface as an unhandled rejection from
   * the ANSWER handler. The "first applied" milestone is only recorded after a
   * genuine, successful add.
   */
  private async addRemoteIceCandidate(candidate: RTCIceCandidate) {
    if (!this.peerConnection) {
      return;
    }
    try {
      await this.peerConnection.addIceCandidate(candidate);
      this.recordFirstRemoteIceCandidateApplied(candidate);
    } catch (error) {
      console.warn(
        'StreamingClient - addRemoteIceCandidate: failed to add remote ICE candidate',
        error,
      );
    }
  }

  private recordFirstRemoteIceCandidateApplied(candidate: RTCIceCandidate) {
    if (this.firstRemoteIceCandidateApplied) {
      return;
    }
    this.firstRemoteIceCandidateApplied = true;
    this.connectionMilestones?.record(
      'first_remote_ice_candidate_applied',
      getIceCandidateMilestoneTags(candidate),
    );
  }

  /**
   * ICE Candidate Trickle
   * As each ICE candidate is gathered from the STUN server it is sent to the
   * webRTC server immediately in an effort to reduce time to connection.
   */
  private onIceCandidate(event: RTCPeerConnectionIceEvent) {
    if (event.candidate) {
      if (!this.firstLocalIceCandidateSent) {
        this.firstLocalIceCandidateSent = true;
        this.connectionMilestones?.record(
          'first_local_ice_candidate_sent',
          getIceCandidateMilestoneTags(event.candidate),
        );
      }
      if (this.iceRestartCandidateBuffer) {
        // Hold until the re-offer is sent (see restartIce).
        this.iceRestartCandidateBuffer.push(event.candidate);
        return;
      }
      this.signallingClient.sendIceCandidate(event.candidate);
    } else {
      this.connectionMilestones?.record('ice_gathering_complete');
    }
  }

  private onIceConnectionStateChange() {
    const state = this.peerConnection?.iceConnectionState;
    if (state) {
      this.connectionMilestones?.record('ice_connection_state_changed', {
        iceConnectionState: state,
      });
    }
    switch (state) {
      case 'connected':
      case 'completed':
        this.clearIceDisconnectedGraceTimer();
        this.clearIceRestartWatchdog();
        this.iceRestartInProgress = false;
        this.iceRestartAttempts = 0;
        if (!this.connectionEstablishedMilestoneRecorded) {
          this.connectionEstablishedMilestoneRecorded = true;
          this.connectionMilestones?.record('client_connection_established', {
            iceConnectionState: state,
          });
        }
        if (!this.connectionEstablishedEmitted) {
          this.connectionEstablishedEmitted = true;
          this.publicEventEmitter.emit(AnamEvent.CONNECTION_ESTABLISHED);
        }
        this.startStatsCollection(); // idempotent (guards on statsCollectionInterval)
        break;
      case 'disconnected':
        this.scheduleIceRestartAfterGrace();
        break;
      case 'failed':
        this.clearIceDisconnectedGraceTimer();
        void this.restartIce();
        break;
    }
  }

  private clearIceDisconnectedGraceTimer() {
    if (this.iceDisconnectedGraceTimer) {
      clearTimeout(this.iceDisconnectedGraceTimer);
      this.iceDisconnectedGraceTimer = null;
    }
  }

  private clearIceRestartWatchdog() {
    if (this.iceRestartWatchdogTimer) {
      clearTimeout(this.iceRestartWatchdogTimer);
      this.iceRestartWatchdogTimer = null;
    }
  }

  // Clears the pending ensureSignallingConnected wait (timeout + listener).
  private clearPendingWsOpenWait() {
    if (this.pendingWsOpenTimeout) {
      clearTimeout(this.pendingWsOpenTimeout);
      this.pendingWsOpenTimeout = null;
    }
    if (this.pendingWsOpenListener) {
      this.internalEventEmitter.removeListener(
        InternalEvent.WEB_SOCKET_OPEN,
        this.pendingWsOpenListener,
      );
      this.pendingWsOpenListener = null;
    }
    this.pendingWsOpenReject = null;
  }

  // Stops all restart activity: timers, pending WS wait, and the in-progress gate.
  private cancelIceRestart() {
    this.clearIceDisconnectedGraceTimer();
    this.clearIceRestartWatchdog();
    const reject = this.pendingWsOpenReject;
    this.clearPendingWsOpenWait();
    if (reject) reject(new Error('ice restart cancelled'));
    this.iceRestartCandidateBuffer = null;
    this.iceRestartInProgress = false;
  }

  // Send any candidates buffered while the re-offer was minted+sent, then stop
  // buffering (see restartIce/onIceCandidate).
  private flushIceRestartCandidateBuffer() {
    const buffered = this.iceRestartCandidateBuffer;
    this.iceRestartCandidateBuffer = null;
    if (!buffered) return;
    for (const candidate of buffered) {
      this.signallingClient.sendIceCandidate(candidate);
    }
  }

  private scheduleIceRestartAfterGrace() {
    if (
      this.iceRestartStopped ||
      this.iceRestartInProgress ||
      this.iceDisconnectedGraceTimer
    ) {
      return;
    }
    this.iceDisconnectedGraceTimer = setTimeout(() => {
      this.iceDisconnectedGraceTimer = null;
      if (this.iceRestartStopped) return;
      const state = this.peerConnection?.iceConnectionState;
      if (state === 'disconnected' || state === 'failed') {
        void this.restartIce();
      }
    }, ICE_DISCONNECTED_GRACE_MS);
  }

  /**
   * Resolve once the signalling WebSocket is open (it auto-reconnects on close),
   * or reject if it is terminally closed / times out. Restart offers must never
   * be sent on a dead socket. Timeout + listener are stored so shutdown can clear
   * them (see clearPendingWsOpenWait).
   */
  private ensureSignallingConnected(): Promise<void> {
    if (this.signallingClient.isConnected()) {
      return Promise.resolve();
    }
    if (this.signallingClient.isPermanentlyClosed()) {
      return Promise.reject(new Error('signalling permanently closed'));
    }
    return new Promise<void>((resolve, reject) => {
      this.pendingWsOpenReject = reject;
      this.pendingWsOpenTimeout = setTimeout(() => {
        this.clearPendingWsOpenWait();
        reject(new Error('timed out waiting for signalling WebSocket'));
      }, ENSURE_WS_OPEN_TIMEOUT_MS);
      const onOpen = () => {
        this.clearPendingWsOpenWait();
        resolve();
      };
      this.pendingWsOpenListener = onOpen;
      this.internalEventEmitter.addListener(
        InternalEvent.WEB_SOCKET_OPEN,
        onOpen,
      );
    });
  }

  /**
   * Automatic ICE restart. Mints a new offer with fresh ICE credentials and
   * sends it over the existing channel. Bounded retries via a watchdog; on
   * exhaustion or terminal signalling, falls back to the WebRTC-failure path.
   */
  private async restartIce(): Promise<void> {
    if (
      !this.peerConnection ||
      this.iceRestartInProgress ||
      this.iceRestartStopped
    ) {
      return;
    }
    if (this.signallingClient.isPermanentlyClosed()) {
      // Session is already ending via the signalling layer; stop spinning.
      this.cancelIceRestart();
      return;
    }
    if (this.iceRestartAttempts >= MAX_ICE_RESTART_ATTEMPTS) {
      console.error('StreamingClient - restartIce: exhausted attempts');
      this.connectionMilestones?.publishFailure({
        failureStage: 'ice_connection',
        iceConnectionState: this.peerConnection?.iceConnectionState,
      });
      this.cancelIceRestart();
      this.handleWebrtcFailure(
        'The connection to our servers was lost. Please try again.',
      );
      return;
    }

    // Set the in-progress gate BEFORE any await so a concurrent trigger
    // (watchdog retry + ICE 'failed' event) cannot start a second restart.
    this.iceRestartInProgress = true;
    this.iceRestartAttempts += 1;
    try {
      // Avoid offer glare: only start a fresh offer from a stable signalling state.
      if (this.peerConnection.signalingState !== 'stable') {
        await this.peerConnection.setLocalDescription({ type: 'rollback' });
      }
      // On the first attempt of a restart episode, force a fresh signalling
      // socket. A network switch can leave the old one half-open (readyState
      // still OPEN, no close event), so the offer would be sent into a dead
      // socket and never reach the server. Retries (attempt > 1) reuse the
      // now-live socket so an in-flight answer isn't dropped.
      if (this.iceRestartAttempts === 1) {
        this.signallingClient.reconnectForIceRestart();
      }
      await this.ensureSignallingConnected();
      if (this.iceRestartStopped) return;
      // ICE may have recovered on its own while we waited for signalling.
      const currentIceState = this.peerConnection.iceConnectionState;
      if (currentIceState === 'connected' || currentIceState === 'completed') {
        this.iceRestartInProgress = false;
        return;
      }

      this.connectionReceivedAnswer = false;
      this.remoteIceCandidateBuffer = [];

      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      // Buffer local candidates that gather from setLocalDescription until the
      // re-offer is sent. The engine queues remote candidates only while it has
      // no remote description; during a restart it still holds the OLD ICE
      // credentials, so a candidate arriving before the re-offer is applied would
      // be added against the old generation and dropped. WS messages are handled
      // in order, so sending the offer first pins the new credentials server-side.
      this.iceRestartCandidateBuffer = [];
      await this.peerConnection.setLocalDescription(offer);
      if (!this.peerConnection.localDescription) {
        throw new Error('null local description after ICE restart offer');
      }
      await this.signallingClient.sendOffer(
        this.peerConnection.localDescription,
      );
      this.flushIceRestartCandidateBuffer();

      this.iceRestartAwaitedAnswer = false;
      this.clearIceRestartWatchdog();
      this.iceRestartWatchdogTimer = setTimeout(
        () => this.onIceRestartWatchdog(),
        ICE_RESTART_WATCHDOG_MS,
      );
    } catch (err) {
      // The offer never made it out; drop candidates buffered for it (a retry
      // mints a fresh offer and gathers again).
      this.iceRestartCandidateBuffer = null;
      console.error('StreamingClient - restartIce: error', err);
      this.iceRestartInProgress = false;
      if (
        this.iceRestartStopped ||
        this.signallingClient.isPermanentlyClosed()
      ) {
        this.cancelIceRestart();
        return; // signalling layer already emitted CONNECTION_CLOSED
      }
      this.clearIceRestartWatchdog();
      this.iceRestartWatchdogTimer = setTimeout(() => {
        this.iceRestartWatchdogTimer = null;
        void this.restartIce();
      }, ICE_RESTART_WATCHDOG_MS);
    }
  }

  // Watchdog for an outstanding restart offer. Only rolls back and re-offers
  // once the current offer is resolved, so a second offer is never minted while
  // the first offer's answer is still in flight (the ANSWER handler could
  // otherwise apply it against the wrong offer).
  private onIceRestartWatchdog() {
    this.iceRestartWatchdogTimer = null;
    this.iceRestartInProgress = false;
    if (this.iceRestartStopped) return;
    const state = this.peerConnection?.iceConnectionState;
    if (state === 'connected' || state === 'completed') return;
    if (!this.connectionReceivedAnswer && !this.iceRestartAwaitedAnswer) {
      // Offer still unanswered: give the in-flight answer one more cycle before
      // rolling it back and re-offering.
      // ponytail: single grace cycle. An answer lost then arriving >2 cycles
      // late could still glare with the next offer, but that self-heals via
      // ICE-fail -> retry. Add generation tagging only if it shows up for real.
      this.iceRestartAwaitedAnswer = true;
      this.iceRestartInProgress = true;
      this.iceRestartWatchdogTimer = setTimeout(
        () => this.onIceRestartWatchdog(),
        ICE_RESTART_WATCHDOG_MS,
      );
      return;
    }
    void this.restartIce();
  }

  private onConnectionStateChange() {
    const connectionState = this.peerConnection?.connectionState;
    if (connectionState) {
      this.connectionMilestones?.record('webrtc_connection_state_changed', {
        connectionState,
      });
    }
    if (connectionState === 'failed') {
      const iceState = this.peerConnection?.iceConnectionState;
      const recovering =
        !this.iceRestartStopped &&
        (iceState === 'disconnected' || iceState === 'failed');
      // A recoverable ICE failure also flips the aggregate state to 'failed'.
      // The recorder is first-call-wins, so don't finalize failure telemetry
      // while the ICE restart is still recovering; the terminal publish comes
      // from restartIce (exhausted) or the 'closed' branch below. A genuine
      // non-ICE failure (e.g. DTLS with ICE still connected) still publishes.
      if (!recovering) {
        this.connectionMilestones?.publishFailure({
          failureStage: 'webrtc_connection',
          connectionState,
        });
      }
    }
    if (this.peerConnection?.connectionState === 'closed') {
      console.error(
        'StreamingClient - onConnectionStateChange: Connection closed',
      );
      this.handleWebrtcFailure(
        'The connection to our servers was lost. Please try again.',
      );
    }
  }

  private handleWebrtcFailure(err: any) {
    this.connectionMilestones?.record('webrtc_failure', getErrorTags(err));
    this.connectionMilestones?.publishFailure({
      failureStage: 'webrtc',
      ...getErrorTags(err),
    });
    console.error({ message: 'StreamingClient - handleWebrtcFailure: ', err });
    if (err.name === 'NotAllowedError' && err.message === 'Permission denied') {
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        ConnectionClosedCode.MICROPHONE_PERMISSION_DENIED,
      );
    } else {
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        ConnectionClosedCode.WEBRTC_FAILURE,
      );
    }

    try {
      this.stopConnection();
    } catch (error) {
      console.error(
        'StreamingClient - handleWebrtcFailure: error stopping connection',
        error,
      );
    }
  }

  private onTrackEventHandler(event: RTCTrackEvent) {
    if (event.track.kind === 'video') {
      this.connectionMilestones?.record('video_track_received');
      // start polling stats to detect successful video data received
      this.startSuccessMetricPolling();

      this.videoStream = event.streams[0];
      this.publicEventEmitter.emit(
        AnamEvent.VIDEO_STREAM_STARTED,
        this.videoStream,
      );
      if (this.videoElement) {
        this.videoElement.srcObject = this.videoStream;
        const handle = this.videoElement.requestVideoFrameCallback(() => {
          // unregister the callback after the first frame
          this.videoElement?.cancelVideoFrameCallback(handle);
          this.publicEventEmitter.emit(AnamEvent.VIDEO_PLAY_STARTED);
          this.recordSessionSuccess('videoElement');
        });
      }
    } else if (event.track.kind === 'audio') {
      this.connectionMilestones?.record('audio_track_received');
      this.audioStream = event.streams[0];
      this.publicEventEmitter.emit(
        AnamEvent.AUDIO_STREAM_STARTED,
        this.audioStream,
      );
    }
  }
  /**
   * Set up the data channels for sending and receiving messages
   */
  private async setupDataChannels() {
    if (!this.peerConnection) {
      console.error(
        'StreamingClient - setupDataChannels: peer connection is not initialized',
      );
      return;
    }

    /**
     * Audio - Validate user-provided stream only
     *
     * If the user provided an audio stream, validate it has audio tracks
     * Microphone permission request will be handled asynchronously
     */
    if (!this.disableInputAudio && this.inputAudioStream) {
      // verify the user provided stream has audio tracks
      if (!this.inputAudioStream.getAudioTracks().length) {
        throw new Error(
          'StreamingClient - setupDataChannels: user provided stream does not have audio tracks',
        );
      }
    }

    /**
     * Text
     *
     * Create the data channel for sending and receiving text.
     * There is no input stream for text, instead the sending of data is triggered by a UI interaction.
     */
    const dataChannel = this.peerConnection.createDataChannel('session', {
      ordered: true,
    });
    this.connectionMilestones?.record('data_channel_created');
    dataChannel.onopen = () => {
      this.dataChannel = dataChannel ?? null;
      this.connectionMilestones?.record('data_channel_open');
    };
    dataChannel.onclose = () => {
      this.connectionMilestones?.record('data_channel_closed');
    };
    // pass text message to the message history client
    dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        // Handle known message types
        switch (message.messageType) {
          case DataChannelMessage.SPEECH_TEXT:
            this.internalEventEmitter.emit(
              InternalEvent.WEBRTC_CHAT_MESSAGE_RECEIVED,
              message.data as WebRtcTextMessageEvent,
            );
            break;
          case DataChannelMessage.CLIENT_TOOL_EVENT:
            // legacy support for client tool events sent via data channel. New events should use the dedicated tool call event messages
            // newer engines should only be sending client tool events via the dedicated tool call event messages, but we will keep supporting this for older engine versions
            const webRtcToolEvent = message.data as WebRtcClientToolEvent;

            this.internalEventEmitter.emit(
              InternalEvent.WEBRTC_CLIENT_TOOL_EVENT_RECEIVED,
              webRtcToolEvent,
            );
            const clientToolEvent =
              ToolCallManager.WebRTCClientToolEventToClientToolEvent(
                webRtcToolEvent,
              );
            this.publicEventEmitter.emit(
              AnamEvent.CLIENT_TOOL_EVENT_RECEIVED,
              clientToolEvent,
            );
            break;
          case DataChannelMessage.TOOL_CALL_STARTED_EVENT:
            const webRtcToolCallStartedEvent =
              message.data as WebRtcToolCallStartedEvent;
            this.publicEventEmitter.emit(
              AnamEvent.TOOL_CALL_STARTED,
              this.toolCallManager.WebRTCToolCallStartedEventToToolCallStartedPayload(
                webRtcToolCallStartedEvent,
              ),
            );
            this.internalEventEmitter.emit(
              InternalEvent.WEBRTC_TOOL_CALL_STARTED_EVENT_RECEIVED,
              webRtcToolCallStartedEvent,
            );
            break;
          case DataChannelMessage.TOOL_CALL_COMPLETED_EVENT:
            const webRtcToolCallCompletedEvent =
              message.data as WebRtcToolCallCompletedEvent;
            this.publicEventEmitter.emit(
              AnamEvent.TOOL_CALL_COMPLETED,
              this.toolCallManager.webRTCToolCallCompletedEventToToolCallCompletedPayload(
                webRtcToolCallCompletedEvent,
              ),
            );
            this.internalEventEmitter.emit(
              InternalEvent.WEBRTC_TOOL_CALL_COMPLETED_EVENT_RECEIVED,
              webRtcToolCallCompletedEvent,
            );
            break;
          case DataChannelMessage.TOOL_CALL_FAILED_EVENT:
            const webRtcToolCallFailedEvent =
              message.data as WebRtcToolCallFailedEvent;
            this.publicEventEmitter.emit(
              AnamEvent.TOOL_CALL_FAILED,
              this.toolCallManager.webRTCToolCallFailedEventToToolCallFailedPayload(
                webRtcToolCallFailedEvent,
              ),
            );
            this.internalEventEmitter.emit(
              InternalEvent.WEBRTC_TOOL_CALL_FAILED_EVENT_RECEIVED,
              webRtcToolCallFailedEvent,
            );
            break;
          case DataChannelMessage.REASONING_TEXT:
            this.internalEventEmitter.emit(
              InternalEvent.WEBRTC_REASONING_TEXT_MESSAGE_RECEIVED,
              message.data as WebRtcReasoningTextMessageEvent,
            );
            break;
          case DataChannelMessage.USER_SPEECH_STARTED:
            this.publicEventEmitter.emit(
              AnamEvent.USER_SPEECH_STARTED,
              message.data?.user_action_correlation_id ?? 'unknown',
            );
            break;
          case DataChannelMessage.USER_SPEECH_ENDED:
            this.publicEventEmitter.emit(
              AnamEvent.USER_SPEECH_ENDED,
              message.data?.user_action_correlation_id ?? 'unknown',
            );
            break;
          // Unknown message types are silently ignored to maintain forward compatibility
          default:
            break;
        }
      } catch (error) {
        console.error('Failed to parse data channel message:', error);
      }
    };
  }

  /**
   * Request microphone permission asynchronously without blocking connection
   */
  private async requestMicrophonePermissionAsync() {
    if (this.inputAudioState.permissionState === AudioPermissionState.PENDING) {
      return; // Already requesting
    }

    this.inputAudioState = {
      ...this.inputAudioState,
      permissionState: AudioPermissionState.PENDING,
    };

    this.connectionMilestones?.record('microphone_permission_pending');
    this.publicEventEmitter.emit(AnamEvent.MIC_PERMISSION_PENDING);

    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
      };

      // If an audio device ID is provided in the options, use it
      if (this.audioDeviceId) {
        audioConstraints.deviceId = {
          exact: this.audioDeviceId,
        };
      }

      this.inputAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });

      this.inputAudioState = {
        ...this.inputAudioState,
        permissionState: AudioPermissionState.GRANTED,
      };

      this.connectionMilestones?.record('microphone_permission_granted');
      this.publicEventEmitter.emit(AnamEvent.MIC_PERMISSION_GRANTED);

      // Now add the audio track to the existing connection
      await this.setupAudioTrack();
    } catch (error) {
      console.error('Failed to get microphone permission:', error);
      this.inputAudioState = {
        ...this.inputAudioState,
        permissionState: AudioPermissionState.DENIED,
      };

      this.connectionMilestones?.record('microphone_permission_denied', {
        ...getErrorTags(error),
      });
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.publicEventEmitter.emit(
        AnamEvent.MIC_PERMISSION_DENIED,
        errorMessage,
      );
    }
  }

  /**
   * Set up audio track and add it to the peer connection using replaceTrack
   */
  private async setupAudioTrack() {
    if (!this.peerConnection || !this.inputAudioStream) {
      return;
    }

    // verify the stream has audio tracks
    if (!this.inputAudioStream.getAudioTracks().length) {
      console.error(
        'StreamingClient - setupAudioTrack: stream does not have audio tracks',
      );
      return;
    }

    // mute the audio tracks if the user has muted the microphone
    if (this.inputAudioState.isMuted) {
      this.muteAllAudioTracks();
    }

    const audioTrack = this.inputAudioStream.getAudioTracks()[0];

    // Find the audio sender
    const existingSenders = this.peerConnection.getSenders();
    const audioSender = existingSenders.find(
      (sender) =>
        sender.track?.kind === 'audio' ||
        (sender.track === null && sender.dtmf !== null), // audio sender without track
    );

    if (audioSender) {
      // Replace existing track (or null track) with our audio track
      try {
        await audioSender.replaceTrack(audioTrack);
      } catch (error) {
        console.error('Failed to replace audio track:', error);
        // Fallback: add track normally
        this.peerConnection.addTrack(audioTrack, this.inputAudioStream);
      }
    } else {
      // No audio sender found, add track normally
      this.peerConnection.addTrack(audioTrack, this.inputAudioStream);
    }

    // pass the stream to the callback
    this.connectionMilestones?.record('input_audio_stream_started', {
      audioTrackCount: this.inputAudioStream.getAudioTracks().length,
    });
    this.publicEventEmitter.emit(
      AnamEvent.INPUT_AUDIO_STREAM_STARTED,
      this.inputAudioStream,
    );
  }

  private async initPeerConnectionAndSendOffer() {
    await this.initPeerConnection();

    if (!this.peerConnection) {
      console.error(
        'StreamingClient - initPeerConnectionAndSendOffer: peer connection is not initialized',
      );
      return;
    }

    // create offer and set local description
    try {
      this.connectionMilestones?.record('offer_creation_started');
      const offer: RTCSessionDescriptionInit =
        await this.peerConnection.createOffer();
      this.connectionMilestones?.record('offer_creation_completed');
      await this.peerConnection.setLocalDescription(offer);
      this.connectionMilestones?.record('local_description_set');
    } catch (error) {
      console.error(
        'StreamingClient - initPeerConnectionAndSendOffer: error creating offer',
        error,
      );
      this.connectionMilestones?.record('offer_creation_failed', {
        ...getErrorTags(error),
      });
      this.connectionMilestones?.publishFailure({
        failureStage: 'offer_creation',
        ...getErrorTags(error),
      });
    }

    if (!this.peerConnection.localDescription) {
      throw new Error(
        'StreamingClient - initPeerConnectionAndSendOffer: local description is null',
      );
    }
    await this.signallingClient.sendOffer(this.peerConnection.localDescription);
    this.connectionMilestones?.record('offer_sent');
  }

  private async shutdown() {
    this.iceRestartStopped = true;
    this.cancelIceRestart();
    if (this.showPeerConnectionStatsReport) {
      const stats = await this.peerConnection?.getStats();
      if (stats) {
        const report = createRTCStatsReport(
          stats,
          this.peerConnectionStatsReportOutputFormat,
        );
        if (report) {
          console.log(report, undefined, 2);
        }
      }
    }
    // stop stats collection
    if (this.statsCollectionInterval) {
      clearInterval(this.statsCollectionInterval);
      this.statsCollectionInterval = null;
    }
    // reset video frame polling
    if (this.successMetricPoller) {
      clearInterval(this.successMetricPoller);
      this.successMetricPoller = null;
    }
    this.successMetricFired = false;

    // stop the input audio stream
    try {
      if (this.inputAudioStream) {
        this.inputAudioStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
      this.inputAudioStream = null;
    } catch (error) {
      console.error(
        'StreamingClient - shutdown: error stopping input audio stream',
        error,
      );
    }

    // stop the signalling client
    try {
      this.signallingClient.stop();
    } catch (error) {
      console.error(
        'StreamingClient - shutdown: error stopping signallilng',
        error,
      );
    }

    // close the peer connection
    try {
      if (
        this.peerConnection &&
        this.peerConnection.connectionState !== 'closed'
      ) {
        this.peerConnection.onconnectionstatechange = null;
        this.peerConnection.close();
        this.peerConnection = null;
      }
    } catch (error) {
      console.error(
        'StreamingClient - shutdown: error closing peer connection',
        error,
      );
    }
  }
}

const getIceCandidateMilestoneTags = (
  candidate: RTCIceCandidate,
): Record<string, string | number> => {
  const safeCandidate = candidate as RTCIceCandidate & {
    type?: string;
    protocol?: string;
    relayProtocol?: string;
    tcpType?: string;
    component?: string;
  };

  return removeEmptyTags({
    candidateType: safeCandidate.type,
    protocol: safeCandidate.protocol,
    relayProtocol: safeCandidate.relayProtocol,
    tcpType: safeCandidate.tcpType,
    component: safeCandidate.component,
  });
};

const getErrorTags = (error: unknown): Record<string, string | number> => {
  if (error instanceof Error) {
    return removeEmptyTags({ errorName: error.name });
  }

  if (typeof error === 'object' && error !== null) {
    const possibleError = error as { name?: unknown; code?: unknown };
    return removeEmptyTags({
      errorName:
        typeof possibleError.name === 'string' ? possibleError.name : undefined,
      errorCode:
        typeof possibleError.code === 'string' ||
        typeof possibleError.code === 'number'
          ? possibleError.code
          : undefined,
    });
  }

  return {};
};

const removeEmptyTags = (
  tags: Record<string, string | number | undefined>,
): Record<string, string | number> => {
  const sanitizedTags: Record<string, string | number> = {};
  Object.entries(tags).forEach(([key, value]) => {
    if (value !== undefined) {
      sanitizedTags[key] = value;
    }
  });
  return sanitizedTags;
};
