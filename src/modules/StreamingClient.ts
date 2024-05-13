import {
  DEFAULT_ICE_SERVERS,
  PUBLIC_MESSAGE_ON_SIGNALLING_CLIENT_CONNECTION_FAILURE,
  PUBLIC_MESSAGE_ON_WEBRTC_FAILURE,
} from "../lib/constants";
import { SignalMessage, SignalMessageAction } from "../types/signalling";
import { TextMessageEvent } from "../types/streaming";
import { StreamingClientOptions } from "../types/streaming/StreamingClientOptions";
import {
  SignallingClient,
  DEFATULT_OPTIONS as DEFAULT_SIGNALLING_OPTIONS,
} from "./SignallingClient";

const DEFAULT_OPTIONS: StreamingClientOptions = {
  videoElementId: "video",
  audioElementId: "audio",
  signalling: DEFAULT_SIGNALLING_OPTIONS,
};

export class StreamingClient {
  protected signallingClient: SignallingClient;

  protected onReceiveMessageCallback?: (messageEvent: TextMessageEvent) => void;
  protected onConnectionEstablishedCallback?: () => void;
  protected onConnectionClosedCallback?: (reason: string) => void;
  protected onInputAudioStreamStartCallback?: (
    audioStream: MediaStream
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

  constructor(
    sessionId: string,
    options: StreamingClientOptions = DEFAULT_OPTIONS,
    onReceiveMessageCallback?: (messageEvent: TextMessageEvent) => void,
    onConnectionEstablishedCallback?: () => void,
    onConnectionClosedCallback?: (reason: string) => void,
    onInputAudioStreamStartCallback?: (audioStream: MediaStream) => void,
    onVideoStreamStartCallback?: (videoStream: MediaStream) => void,
    onVideoPlayStartedCallback?: () => void,
    onAudioStreamStartCallback?: (audioStream: MediaStream) => void
  ) {
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

    // set up streaming targets
    const { videoElementId, audioElementId } = options;
    if (videoElementId) {
      const videoElement = document.getElementById(videoElementId);
      if (!videoElement) {
        throw new Error(
          `StreamingClient: video element with id ${videoElementId} not found`
        );
      }
      this.videoElement = videoElement as HTMLVideoElement;
    }
    if (audioElementId) {
      const audioElement = document.getElementById(audioElementId);
      if (!audioElement) {
        throw new Error(
          `StreamingClient: audio element with id ${audioElementId} not found`
        );
      }
      this.audioElement = audioElement as HTMLAudioElement;
    }

    // initialize signalling client
    this.signallingClient = new SignallingClient(
      sessionId,
      options.signalling,
      this.onSignalMessage.bind(this),
      this.onSignallingClientConnected.bind(this),
      this.onSignallingClientFailed.bind(this)
    );
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
    console.log("StreamingClient - sendDataMessage: sending message", message);
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.send(message);
    }
  }

  public async startConnection() {
    console.log("StreamingClient - startConnection: starting connection");
    try {
      if (this.peerConnection) {
        console.error(
          "StreamingClient - startConnection: peer connection already exists"
        );
        return;
      }
      this.signallingClient.connect();
    } catch (error) {
      this.handleWebrtcFailure(error);
    }
  }

  public stopConnection() {
    console.log("StreamingClient - stopConnection: stopping connection");
    this.shutdown();
  }

  private async initPeerConnection() {
    this.peerConnection = new RTCPeerConnection({
      iceServers: DEFAULT_ICE_SERVERS,
    });
    // set event handlers
    this.peerConnection.onicecandidate = this.onIceCandidate.bind(this);
    this.peerConnection.oniceconnectionstatechange =
      this.onIceConnectionStateChange.bind(this);
    this.peerConnection.onconnectionstatechange =
      this.onConnectionStateChange.bind(this);
    this.peerConnection.addEventListener(
      "track",
      this.onTrackEventHandler.bind(this)
    );

    // set up data channels
    await this.setupDataChannels();

    // add transceivers
    this.peerConnection.addTransceiver("video", { direction: "recvonly" });
    this.peerConnection.addTransceiver("audio", { direction: "sendrecv" });
  }

  private async onSignalMessage(signalMessage: SignalMessage) {
    if (!this.peerConnection) {
      console.error(
        "StreamingClient - onSignalMessage: peerConnection is not initialized"
      );
      return;
    }
    switch (signalMessage.actionType) {
      case SignalMessageAction.ANSWER:
        console.log(
          "StreamingClient - onSignalMessage: received answer ",
          signalMessage.payload
        );
        const answer = signalMessage.payload as RTCSessionDescriptionInit;
        await this.peerConnection.setRemoteDescription(answer);
        this.connectionReceivedAnswer = true;
        // flush the remote buffer
        this.flushRemoteIceCandidateBuffer();
        break;
      case SignalMessageAction.ICE_CANDIDATE:
        console.log(
          "StreamingClient - onSignalMessage: received ice candidate ",
          signalMessage.payload
        );
        const candidate = new RTCIceCandidate(signalMessage.payload);
        if (this.connectionReceivedAnswer) {
          await this.peerConnection.addIceCandidate(candidate);
        } else {
          this.remoteIceCandidateBuffer.push(candidate);
        }
        break;
      case SignalMessageAction.END_SESSION:
        console.log("StreamingClient - onSignalMessage: received end session");
        const reason = signalMessage.payload as string;
        if (this.onConnectionClosedCallback) {
          this.onConnectionClosedCallback(reason);
        }
        // close the peer connection
        this.shutdown();
        break;
      default:
        console.error(
          "StreamingClient - onSignalMessage: unknown signal message action type",
          signalMessage
        );
    }
  }

  private async onSignallingClientConnected() {
    console.log(
      "StreamingClient - onSignallingClientConnected: signalling client connected"
    );
    if (!this.peerConnection) {
      // TODO: THIS COULD BE ERROR PRONE - the old code in client has an error here
      try {
        await this.initPeerConnectionAndSendOffer();
      } catch (err) {
        console.error(
          "StreamingClient - onSignallingClientConnected: Error initializing peer connection",
          err
        );
        this.handleWebrtcFailure(err);
      }
    }
  }

  private onSignallingClientFailed() {
    console.error(
      "StreamingClient - onSignallingClientFailed: signalling client failed"
    );
    if (this.onConnectionClosedCallback) {
      this.onConnectionClosedCallback(
        PUBLIC_MESSAGE_ON_SIGNALLING_CLIENT_CONNECTION_FAILURE
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

  // TODO: should be able to use the connection ref from the function rather than the class variable
  private onIceConnectionStateChange() {
    if (
      this.peerConnection?.iceConnectionState === "connected" ||
      this.peerConnection?.iceConnectionState === "completed"
    ) {
      console.log(
        "StreamingClient - onIceConnectionStateChange: ICE Connection State is connected"
      );
      if (this.onConnectionEstablishedCallback) {
        this.onConnectionEstablishedCallback();
      }
    }
  }

  private onConnectionStateChange() {
    console.log(
      "StreamingClient - onConnectionStateChange: Connection State is ",
      this.peerConnection?.connectionState
    );
    if (this.peerConnection?.connectionState === "closed") {
      console.error(
        "StreamingClient - onConnectionStateChange: Connection closed"
      );
      this.handleWebrtcFailure(
        "The connection to our servers was lost. Please try again."
      );
    }
  }

  private handleWebrtcFailure(err: any) {
    console.error("StreamingClient - handleWebrtcFailure: ", err);
    try {
      this.stopConnection();
    } catch (error) {
      console.error(
        "StreamingClient - handleWebrtcFailure: error stopping connection",
        error
      );
    }
    if (this.onConnectionClosedCallback) {
      this.onConnectionClosedCallback(PUBLIC_MESSAGE_ON_WEBRTC_FAILURE);
    }
  }

  private onTrackEventHandler(event: RTCTrackEvent) {
    console.log(
      "StreamingClient - onTrackEventHandler: received track event",
      event
    );
    if (event.track.kind === "video") {
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
    } else if (event.track.kind === "audio") {
      // TODO: this check is not in the original code
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
        "StreamingClient - setupDataChannels: peer connection is not initialized"
      );
      return;
    }
    /**
     * Audio
     *
     * Capture the audio stream from the user's microphone and send it to the peer connection
     */
    const audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
      },
    });
    this.inputAudioStream = audioStream;
    const audioTrack = audioStream.getAudioTracks()[0];
    this.peerConnection.addTrack(audioTrack, audioStream);
    console.log(
      "StreamingClient - setupDataChannels: audio track added: " +
        audioTrack.readyState
    ); // Should log "live"
    console.log(
      "StreamingClient - setupDataChannels: echo canellation: " +
        audioTrack.getCapabilities().echoCancellation
    );
    // pass the stream to the callback if it exists
    if (this.onInputAudioStreamStartCallback) {
      this.onInputAudioStreamStartCallback(audioStream);
    }

    /**
     * Text
     *
     * Create the data channel for sending and receiving text.
     * There is no input stream for text, instead the sending of data is triggered by a UI interaction.
     */
    const dataChannel = this.peerConnection.createDataChannel("chat", {
      ordered: true,
    });
    dataChannel.onopen = () => {
      this.dataChannel = dataChannel ?? null;
    };
    dataChannel.onclose = () => {
      // TODO: should we set the data channel to null here?
      console.log("StreamingClient - setupDataChannels: data channel closed");
    };
    // pass test messages to the callback
    dataChannel.onmessage = (event) => {
      if (this.onReceiveMessageCallback) {
        this.onReceiveMessageCallback(
          JSON.parse(event.data) as TextMessageEvent
        );
      }
    };
  }

  private async initPeerConnectionAndSendOffer() {
    await this.initPeerConnection();

    if (!this.peerConnection) {
      console.error(
        "StreamingClient - initPeerConnectionAndSendOffer: peer connection is not initialized"
      );
      return;
    }

    // create offer and set local description
    const offer: RTCSessionDescriptionInit =
      await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    if (!this.peerConnection.localDescription) {
      throw new Error(
        "StreamingClient - initPeerConnectionAndSendOffer: local description is null"
      );
    }
    await this.signallingClient.sendOffer(this.peerConnection.localDescription);
  }

  private shutdown() {
    console.log("StreamingClient - shutdown: shutting down");
    try {
      if (this.inputAudioStream) {
        this.inputAudioStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
      this.inputAudioStream = null;
    } catch (error) {
      console.error(
        "StreamingClient - shutdown: error stopping input audio stream",
        error
      );
    }
    try {
      this.signallingClient.stop();
    } catch (error) {
      console.error(
        "StreamingClient - shutdown: error stopping signallilng",
        error
      );
    }
    try {
      if (
        this.peerConnection &&
        this.peerConnection.connectionState !== "closed"
      ) {
        this.peerConnection.onconnectionstatechange = null;
        this.peerConnection.close();
        console.log("StreamingClient - shutdown: peer connection closed");
        this.peerConnection = null;
      }
    } catch (error) {
      console.error(
        "StreamingClient - shutdown: error closing peer connection",
        error
      );
    }
  }
}
