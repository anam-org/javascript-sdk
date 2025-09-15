import {
  EngineApiRestClient,
  InternalEventEmitter,
  PublicEventEmitter,
  SignallingClient,
} from '../modules';
import {
  AnamEvent,
  InputAudioState,
  InternalEvent,
  SignalMessage,
  SignalMessageAction,
  StreamingClientOptions,
  WebRtcTextMessageEvent,
  ConnectionClosedCode,
} from '../types';
import { TalkMessageStream } from '../types/TalkMessageStream';
import { TalkStreamInterruptedSignalMessage } from '../types/signalling/TalkStreamInterruptedSignalMessage';
import {
  ClientMetricMeasurement,
  createRTCStatsReport,
  sendClientMetric,
} from '../lib/ClientMetrics';

const SUCCESS_METRIC_POLLING_TIMEOUT_MS = 15000; // After this time we will stop polling for the first frame and consider the session a failure.
const STATS_COLLECTION_INTERVAL_MS = 5000;

export class StreamingClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;
  private signallingClient: SignallingClient;
  private engineApiRestClient: EngineApiRestClient;
  private iceServers: RTCIceServer[];
  private peerConnection: RTCPeerConnection | null = null;
  private connectionReceivedAnswer = false;
  private remoteIceCandidateBuffer: RTCIceCandidate[] = [];
  private inputAudioStream: MediaStream | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private videoStream: MediaStream | null = null;
  private audioStream: MediaStream | null = null;
  private inputAudioState: InputAudioState = { isMuted: false };
  private audioDeviceId: string | undefined;
  private disableInputAudio: boolean;
  private successMetricPoller: ReturnType<typeof setInterval> | null = null;
  private successMetricFired = false;
  private showPeerConnectionStatsReport: boolean = false;
  private peerConnectionStatsReportOutputFormat: 'console' | 'json' = 'console';
  private statsCollectionInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    sessionId: string,
    options: StreamingClientOptions,
    publicEventEmitter: PublicEventEmitter,
    internalEventEmitter: InternalEventEmitter,
  ) {
    this.publicEventEmitter = publicEventEmitter;
    this.internalEventEmitter = internalEventEmitter;
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
    // set ice servers
    this.iceServers = options.iceServers;
    // initialize signalling client
    this.signallingClient = new SignallingClient(
      sessionId,
      options.signalling,
      this.publicEventEmitter,
      this.internalEventEmitter,
    );
    // initialize engine API client
    this.engineApiRestClient = new EngineApiRestClient(
      options.engine.baseUrl,
      sessionId,
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

  private startSuccessMetricPolling() {
    if (this.successMetricPoller || this.successMetricFired) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (this.successMetricPoller) {
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
          this.successMetricFired = true;
          sendClientMetric(
            ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_SESSION_SUCCESS,
            '1',
            detectionMethod ? { detectionMethod } : undefined,
          );
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

  public getInputAudioStream(): MediaStream | null {
    return this.inputAudioStream;
  }

  public getVideoStream(): MediaStream | null {
    return this.videoStream;
  }

  public getAudioStream(): MediaStream | null {
    return this.audioStream;
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
      // start the connection
      this.signallingClient.connect();
    } catch (error) {
      console.log('StreamingClient - startConnection: error', error);
      this.handleWebrtcFailure(error);
    }
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

  private async initPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
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
      this.peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    } else {
      this.peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
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
      case SignalMessageAction.ANSWER:
        const answer = signalMessage.payload as RTCSessionDescriptionInit;
        await this.peerConnection.setRemoteDescription(answer);
        this.connectionReceivedAnswer = true;
        // flush the remote buffer
        this.flushRemoteIceCandidateBuffer();
        break;
      case SignalMessageAction.ICE_CANDIDATE:
        const iceCandidateConfig = signalMessage.payload as RTCIceCandidateInit;
        const candidate = new RTCIceCandidate(iceCandidateConfig);
        if (this.connectionReceivedAnswer) {
          await this.peerConnection.addIceCandidate(candidate);
        } else {
          this.remoteIceCandidateBuffer.push(candidate);
        }
        break;
      case SignalMessageAction.END_SESSION:
        const reason = signalMessage.payload as string;
        console.log('StreamingClient - onSignalMessage: reason', reason);
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
      default:
        console.error(
          'StreamingClient - onSignalMessage: unknown signal message action type. Is your anam-sdk version up to date?',
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

  private flushRemoteIceCandidateBuffer() {
    this.remoteIceCandidateBuffer.forEach((candidate) => {
      this.peerConnection?.addIceCandidate(candidate);
    });
    this.remoteIceCandidateBuffer = [];
  }

  /**
   * ICE Candidate Trickle
   * As each ICE candidate is gathered from the STUN server it is sent to the
   * webRTC server immediately in an effort to reduce time to connection.
   */
  private onIceCandidate(event: RTCPeerConnectionIceEvent) {
    if (event.candidate) {
      this.signallingClient.sendIceCandidate(event.candidate);
    }
  }

  private onIceConnectionStateChange() {
    if (
      this.peerConnection?.iceConnectionState === 'connected' ||
      this.peerConnection?.iceConnectionState === 'completed'
    ) {
      this.publicEventEmitter.emit(AnamEvent.CONNECTION_ESTABLISHED);
      // Start collecting stats every 5 seconds
      this.startStatsCollection();
    }
  }

  private onConnectionStateChange() {
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
          if (!this.successMetricFired) {
            this.successMetricFired = true;
            sendClientMetric(
              ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_SESSION_SUCCESS,
              '1',
              { detectionMethod: 'videoElement' },
            );
          }
        });
      }
    } else if (event.track.kind === 'audio') {
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
     * Audio
     *
     * If the user hasn't provided an audio stream, capture the audio stream from the user's microphone and send it to the peer connection
     * If input audio is disabled we don't send any audio to the peer connection
     */
    if (!this.disableInputAudio) {
      if (this.inputAudioStream) {
        // verify the user provided stream has audio tracks
        if (!this.inputAudioStream.getAudioTracks().length) {
          throw new Error(
            'StreamingClient - setupDataChannels: user provided stream does not have audio tracks',
          );
        }
      } else {
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
      }

      // mute the audio tracks if the user has muted the microphone
      if (this.inputAudioState.isMuted) {
        this.muteAllAudioTracks();
      }
      const audioTrack = this.inputAudioStream.getAudioTracks()[0];
      this.peerConnection.addTrack(audioTrack, this.inputAudioStream);
      // pass the stream to the callback if it exists
      this.publicEventEmitter.emit(
        AnamEvent.INPUT_AUDIO_STREAM_STARTED,
        this.inputAudioStream,
      );
    }

    /**
     * Text
     *
     * Create the data channel for sending and receiving text.
     * There is no input stream for text, instead the sending of data is triggered by a UI interaction.
     */
    const dataChannel = this.peerConnection.createDataChannel('chat', {
      ordered: true,
    });
    dataChannel.onopen = () => {
      this.dataChannel = dataChannel ?? null;
    };
    dataChannel.onclose = () => {};
    // pass text message to the message history client
    dataChannel.onmessage = (event) => {
      const messageEvent = JSON.parse(event.data) as WebRtcTextMessageEvent;
      this.internalEventEmitter.emit(
        InternalEvent.WEBRTC_CHAT_MESSAGE_RECEIVED,
        messageEvent,
      );
    };
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
      const offer: RTCSessionDescriptionInit =
        await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
    } catch (error) {
      console.error(
        'StreamingClient - initPeerConnectionAndSendOffer: error creating offer',
        error,
      );
    }

    if (!this.peerConnection.localDescription) {
      throw new Error(
        'StreamingClient - initPeerConnectionAndSendOffer: local description is null',
      );
    }
    await this.signallingClient.sendOffer(this.peerConnection.localDescription);
  }

  private async shutdown() {
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
