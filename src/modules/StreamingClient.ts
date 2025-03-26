import {
  CONNECTION_CLOSED_CODE_MICROPHONE_PERMISSION_DENIED,
  CONNECTION_CLOSED_CODE_NORMAL,
  CONNECTION_CLOSED_CODE_WEBRTC_FAILURE,
} from '../lib/constants';
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
} from '../types';
import { TalkMessageStream } from '../types/TalkMessageStream';
import { TalkStreamInterruptedSignalMessage } from '../types/signalling/TalkStreamInterruptedSignalMessage';

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
  private audioElement: HTMLAudioElement | null = null;
  private audioStream: MediaStream | null = null;
  private inputAudioState: InputAudioState = { isMuted: false };
  private audioDeviceId: string | undefined;
  private isReactNative: boolean = false;

  constructor(
    sessionId: string,
    options: StreamingClientOptions,
    publicEventEmitter: PublicEventEmitter,
    internalEventEmitter: InternalEventEmitter,
  ) {
    this.publicEventEmitter = publicEventEmitter;
    this.internalEventEmitter = internalEventEmitter;

    // Detect if running in React Native environment
    this.isReactNative =
      typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

    // initialize input audio state
    const { inputAudio } = options;
    this.inputAudioState = inputAudio.inputAudioState;
    if (options.inputAudio.userProvidedMediaStream) {
      this.inputAudioStream = options.inputAudio.userProvidedMediaStream;
    }
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

  public setMediaStreamTargetsById(
    videoElementId: string,
    audioElementId: string,
  ) {
    // Only attempt to set DOM elements in web environment
    if (this.isReactNative) {
      return;
    }

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
    if (audioElementId) {
      const audioElement = document.getElementById(audioElementId);
      if (!audioElement) {
        throw new Error(
          `StreamingClient: audio element with id ${audioElementId} not found`,
        );
      }
      this.audioElement = audioElement as HTMLAudioElement;
    }
  }

  public setMediaStreamTargets(
    videoElement?: HTMLVideoElement | null,
    audioElement?: HTMLAudioElement | null,
  ) {
    if (videoElement) {
      this.videoElement = videoElement;
      // If we already have a video stream, set it as the source
      if (this.videoStream && this.videoElement) {
        this.videoElement.srcObject = this.videoStream;
      }
    }

    if (audioElement) {
      this.audioElement = audioElement;
      // If we already have an audio stream, set it as the source
      if (this.audioStream && this.audioElement) {
        this.audioElement.srcObject = this.audioStream;
      }
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

  public stopConnection() {
    this.shutdown();
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
    this.peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
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
          CONNECTION_CLOSED_CODE_NORMAL,
        );
        // close the peer connection
        this.shutdown();
        break;
      case SignalMessageAction.WARNING:
        const message = signalMessage.payload as string;
        console.warn('Warning received from server: ' + message);
        break;
      case SignalMessageAction.TALK_STREAM_INTERRUPTED:
        const chatMessage =
          signalMessage.payload as TalkStreamInterruptedSignalMessage;
        this.publicEventEmitter.emit(
          AnamEvent.TALK_STREAM_INTERRUPTED,
          chatMessage.correlationId,
        );
        break;
      default:
        console.error(
          'StreamingClient - onSignalMessage: unknown signal message action type',
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
        CONNECTION_CLOSED_CODE_MICROPHONE_PERMISSION_DENIED,
      );
    } else {
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        CONNECTION_CLOSED_CODE_WEBRTC_FAILURE,
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
      this.videoStream = event.streams[0];
      this.publicEventEmitter.emit(
        AnamEvent.VIDEO_STREAM_STARTED,
        this.videoStream,
      );
      if (this.videoElement && !this.isReactNative) {
        this.videoElement.srcObject = this.videoStream;
        if (this.videoElement.requestVideoFrameCallback) {
          const handle = this.videoElement.requestVideoFrameCallback(() => {
            // unregister the callback after the first frame
            this.videoElement?.cancelVideoFrameCallback?.(handle);
            this.publicEventEmitter.emit(AnamEvent.VIDEO_PLAY_STARTED);
          });
        } else {
          // Fallback for browsers or environments that don't support requestVideoFrameCallback
          this.videoElement.onloadeddata = () => {
            this.publicEventEmitter.emit(AnamEvent.VIDEO_PLAY_STARTED);
          };
        }
      } else {
        // For React Native, just emit the event since we don't have direct DOM access
        this.publicEventEmitter.emit(AnamEvent.VIDEO_PLAY_STARTED);
      }
    } else if (event.track.kind === 'audio') {
      this.audioStream = event.streams[0];
      this.publicEventEmitter.emit(
        AnamEvent.AUDIO_STREAM_STARTED,
        this.audioStream,
      );
      if (this.audioElement && !this.isReactNative) {
        this.audioElement.srcObject = this.audioStream;
      }
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
     */
    if (this.inputAudioStream) {
      // verify the user provided stream has audio tracks
      if (!this.inputAudioStream.getAudioTracks().length) {
        throw new Error(
          'StreamingClient - setupDataChannels: user provided stream does not have audio tracks',
        );
      }
    } else {
      // Get user media in a way that works in both web and React Native
      try {
        if (this.isReactNative) {
          // In React Native, we expect the audio stream to be provided externally
          throw new Error(
            'StreamingClient - setupDataChannels: React Native requires a user provided audio stream',
          );
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
          // In web browsers, we can request access to the microphone

          this.inputAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
          });
        }
      } catch (error) {
        console.error('Failed to get user media:', error);
        throw error;
      }
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
    dataChannel.onclose = () => {
      // TODO: should we set the data channel to null here?
    };
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

  private shutdown() {
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
    try {
      this.signallingClient.stop();
    } catch (error) {
      console.error(
        'StreamingClient - shutdown: error stopping signallilng',
        error,
      );
    }
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
