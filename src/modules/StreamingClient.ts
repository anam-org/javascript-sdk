import {
  PUBLIC_MESSAGE_ON_SIGNALLING_CLIENT_CONNECTION_FAILURE,
  PUBLIC_MESSAGE_ON_WEBRTC_FAILURE,
} from '../lib/constants';
import { InputAudioState } from '../types';
import { SignalMessage, SignalMessageAction } from '../types/signalling';
import {
  ConnectionCallbacks,
  WebRtcTextMessageEvent,
} from '../types/streaming';
import { StreamingClientOptions } from '../types/streaming/StreamingClientOptions';
import { EngineApiRestClient } from './EngineApiRestClient';
import { MessageHistoryClient } from './MessageHistoryClient';
import { SignallingClient } from './SignallingClient';

export class StreamingClient {
  protected signallingClient: SignallingClient;
  protected engineApiRestClient: EngineApiRestClient;
  protected messageHistoryClient: MessageHistoryClient;

  protected iceServers: RTCIceServer[];

  protected onReceiveMessageCallback?: (
    messageEvent: WebRtcTextMessageEvent,
  ) => void;
  protected onStreamMessageEventCallback?: (
    messageEvent: WebRtcTextMessageEvent,
  ) => void;
  protected onConnectionEstablishedCallback?: () => void;
  protected onConnectionClosedCallback?: (reason: string) => void;
  protected onInputAudioStreamStartCallback?: (
    audioStream: MediaStream,
  ) => void;
  protected onVideoStreamStartCallback?: (videoStream: MediaStream) => void;
  protected onAudioStreamStartCallback?: (audioStream: MediaStream) => void;
  protected onVideoPlayStartedCallback?: () => void;

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

  constructor(sessionId: string, options: StreamingClientOptions) {
    // initialize input audio state
    const { inputAudio } = options;
    this.inputAudioState = inputAudio.inputAudioState;
    if (options.inputAudio.userProvidedMediaStream) {
      this.inputAudioStream = options.inputAudio.userProvidedMediaStream;
    }
    // set ice servers
    this.iceServers = options.iceServers;
    // initialize message history client
    this.messageHistoryClient = new MessageHistoryClient();
    // initialize signalling client
    this.signallingClient = new SignallingClient(
      sessionId,
      options.signalling,
      this.onSignalMessage.bind(this),
      this.onSignallingClientConnected.bind(this),
      this.onSignallingClientFailed.bind(this),
    );
    // initialize engine API client
    this.engineApiRestClient = new EngineApiRestClient(
      options.engine.baseUrl,
      sessionId,
    );
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

  public setOnVideoStreamStartCallback(
    callback: (videoStream: MediaStream) => void,
  ) {
    this.onVideoStreamStartCallback = callback;
  }

  public setOnAudioStreamStartCallback(
    callback: (audioStream: MediaStream) => void,
  ) {
    this.onAudioStreamStartCallback = callback;
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

  public startConnection(callbacks: ConnectionCallbacks) {
    try {
      if (this.peerConnection) {
        console.error(
          'StreamingClient - startConnection: peer connection already exists',
        );
        return;
      }
      // set callbacks
      this.setConnectionCallbacks(callbacks);
      // start the connection
      this.signallingClient.connect();
    } catch (error) {
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

  private setConnectionCallbacks({
    onMessageStreamEventCallback,
    onMessageHistoryUpdatedCallback,
    onReceiveMessageCallback,
    onConnectionEstablishedCallback,
    onConnectionClosedCallback,
    onInputAudioStreamStartCallback,
    onVideoStreamStartCallback,
    onVideoPlayStartedCallback,
    onAudioStreamStartCallback,
  }: ConnectionCallbacks) {
    if (onMessageStreamEventCallback) {
      this.messageHistoryClient.setOnMessageStreamEvent(
        onMessageStreamEventCallback,
      );
    }
    if (onMessageHistoryUpdatedCallback) {
      this.messageHistoryClient.setOnMessageHistoryUpdated(
        onMessageHistoryUpdatedCallback,
      );
    }
    if (onReceiveMessageCallback) {
      this.onReceiveMessageCallback = onReceiveMessageCallback;
    }
    if (onConnectionEstablishedCallback) {
      this.onConnectionEstablishedCallback = onConnectionEstablishedCallback;
    }
    if (onConnectionClosedCallback) {
      this.onConnectionClosedCallback = onConnectionClosedCallback;
    }
    if (onInputAudioStreamStartCallback) {
      this.onInputAudioStreamStartCallback = onInputAudioStreamStartCallback;
    }
    if (onVideoStreamStartCallback) {
      this.onVideoStreamStartCallback = onVideoStreamStartCallback;
    }
    if (onVideoPlayStartedCallback) {
      this.onVideoPlayStartedCallback = onVideoPlayStartedCallback;
    }
    if (onAudioStreamStartCallback) {
      this.onAudioStreamStartCallback = onAudioStreamStartCallback;
    }
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
        if (this.onConnectionClosedCallback) {
          this.onConnectionClosedCallback(reason);
        }
        // close the peer connection
        this.shutdown();
        break;
      case SignalMessageAction.WARNING:
        const message = signalMessage.payload as string;
        console.warn('Warning received from server: ' + message);
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

  private onSignallingClientFailed() {
    console.error(
      'StreamingClient - onSignallingClientFailed: signalling client failed',
    );
    if (this.onConnectionClosedCallback) {
      this.onConnectionClosedCallback(
        PUBLIC_MESSAGE_ON_SIGNALLING_CLIENT_CONNECTION_FAILURE,
      );
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
      if (this.onConnectionEstablishedCallback) {
        this.onConnectionEstablishedCallback();
      }
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
    console.error('StreamingClient - handleWebrtcFailure: ', err);
    try {
      this.stopConnection();
    } catch (error) {
      console.error(
        'StreamingClient - handleWebrtcFailure: error stopping connection',
        error,
      );
    }
    if (this.onConnectionClosedCallback) {
      this.onConnectionClosedCallback(PUBLIC_MESSAGE_ON_WEBRTC_FAILURE);
    }
  }

  private onTrackEventHandler(event: RTCTrackEvent) {
    if (event.track.kind === 'video') {
      this.videoStream = event.streams[0];
      if (this.onVideoStreamStartCallback) {
        this.onVideoStreamStartCallback(this.videoStream);
      }
      if (this.videoElement) {
        this.videoElement.srcObject = this.videoStream;
        const handle = this.videoElement.requestVideoFrameCallback(() => {
          // unregister the callback after the first frame
          this.videoElement?.cancelVideoFrameCallback(handle);
          if (this.onVideoPlayStartedCallback) {
            this.onVideoPlayStartedCallback();
          }
        });
      }
    } else if (event.track.kind === 'audio') {
      this.audioStream = event.streams[0];
      if (this.onAudioStreamStartCallback) {
        this.onAudioStreamStartCallback(this.audioStream);
      }
      if (this.audioElement) {
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
      this.inputAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
        },
      });
    }

    // mute the audio tracks if the user has muted the microphone
    if (this.inputAudioState.isMuted) {
      this.muteAllAudioTracks();
    }
    const audioTrack = this.inputAudioStream.getAudioTracks()[0];
    this.peerConnection.addTrack(audioTrack, this.inputAudioStream);
    // pass the stream to the callback if it exists
    if (this.onInputAudioStreamStartCallback) {
      this.onInputAudioStreamStartCallback(this.inputAudioStream);
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
    dataChannel.onclose = () => {
      // TODO: should we set the data channel to null here?
    };
    // pass text message to the message history client
    dataChannel.onmessage = (event) => {
      const messageEvent = JSON.parse(event.data) as WebRtcTextMessageEvent;
      this.messageHistoryClient.processWebRtcTextMessageEvent(messageEvent);
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
    const offer: RTCSessionDescriptionInit =
      await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
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
