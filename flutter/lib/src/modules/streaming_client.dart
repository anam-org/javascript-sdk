import 'dart:async';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../types/client_options.dart';
import '../types/events.dart';
import '../types/signal_messages.dart';
import '../utils/constants.dart';
import 'event_emitter.dart';
import 'signalling_client.dart';

class StreamingClient {
  final String sessionId;
  final StreamingClientOptions options;
  final PublicEventEmitter publicEventEmitter;
  final InternalEventEmitter internalEventEmitter;
  
  late final SignallingClient signallingClient;
  RTCPeerConnection? _peerConnection;
  bool _connectionReceivedAnswer = false;
  final List<RTCIceCandidate> _remoteIceCandidateBuffer = [];
  MediaStream? _localStream;
  MediaStream? _remoteVideoStream;
  MediaStream? _remoteAudioStream;
  RTCDataChannel? _dataChannel;
  StreamSubscription? _signalMessageSubscription;
  Timer? _successMetricPoller;
  bool _successMetricFired = false;

  StreamingClient({
    required this.sessionId,
    required this.options,
    required this.publicEventEmitter,
    required this.internalEventEmitter,
  }) {
    // Initialize signalling client
    signallingClient = SignallingClient(
      sessionId: sessionId,
      options: options.signalling,
      publicEventEmitter: publicEventEmitter,
      internalEventEmitter: internalEventEmitter,
    );

    // Listen for events
    internalEventEmitter.on<void>(AnamEvent.webSocketOpen).listen((_) {
      _onSignallingClientConnected();
    });

    _signalMessageSubscription = internalEventEmitter
        .on<SignalMessage>(AnamEvent.signalMessageReceived)
        .listen(_onSignalMessage);
  }

  Future<void> startConnection() async {
    print('DEBUG: StreamingClient.startConnection() called');
    await signallingClient.connect();
  }

  Future<void> stopConnection() async {
    _successMetricPoller?.cancel();
    _signalMessageSubscription?.cancel();
    
    await _localStream?.dispose();
    _localStream = null;
    
    await _remoteVideoStream?.dispose();
    _remoteVideoStream = null;
    
    await _remoteAudioStream?.dispose();
    _remoteAudioStream = null;
    
    await _dataChannel?.close();
    _dataChannel = null;
    
    await _peerConnection?.close();
    _peerConnection = null;
    
    signallingClient.stop();
    _connectionReceivedAnswer = false;
    _remoteIceCandidateBuffer.clear();
  }

  Future<void> _initializePeerConnection() async {
    print('DEBUG: _initializePeerConnection() called');
    try {
      final configuration = <String, dynamic>{
        'iceServers': options.iceServers,
        'sdpSemantics': 'unified-plan',
      };

      print('DEBUG: Creating peer connection with ${options.iceServers.length} ICE servers');
      _peerConnection = await createPeerConnection(configuration);
      print('DEBUG: Peer connection created successfully');

      // Set up event handlers
      _peerConnection!.onIceCandidate = _onIceCandidate;
      _peerConnection!.onIceConnectionState = _onIceConnectionStateChange;
      _peerConnection!.onConnectionState = _onConnectionStateChange;
      _peerConnection!.onTrack = _onTrackEvent;
      _peerConnection!.onDataChannel = _onDataChannel;
      print('DEBUG: Event handlers set up');

      // Set up data channel
      await _setupDataChannels();
      print('DEBUG: Data channels set up');

      // Add transceivers for video and audio
      print('DEBUG: Adding video transceiver');
      await _peerConnection!.addTransceiver(
        kind: RTCRtpMediaType.RTCRtpMediaTypeVideo,
        init: RTCRtpTransceiverInit(direction: TransceiverDirection.RecvOnly),
      );
      
      print('DEBUG: Adding audio transceiver');
      await _peerConnection!.addTransceiver(
        kind: RTCRtpMediaType.RTCRtpMediaTypeAudio,
        init: RTCRtpTransceiverInit(
          direction: options.inputAudio.disableInputAudio 
            ? TransceiverDirection.RecvOnly 
            : TransceiverDirection.SendRecv
        ),
      );

      // Add local stream if not disabled
      if (!options.inputAudio.disableInputAudio) {
        print('DEBUG: Setting up local stream');
        await _setupLocalStream();
      }
      
      print('DEBUG: _initializePeerConnection() completed successfully');
    } catch (e, stackTrace) {
      print('ERROR: _initializePeerConnection failed: $e');
      print('STACK TRACE: $stackTrace');
      rethrow;
    }
  }

  Future<void> _setupLocalStream() async {
    try {
      final constraints = <String, dynamic>{
        'audio': {
          'mandatory': {},
          'optional': [],
        },
        'video': false,
      };

      if (options.inputAudio.audioDeviceId != null) {
        constraints['audio']['mandatory']['sourceId'] = options.inputAudio.audioDeviceId;
      }

      _localStream = await navigator.mediaDevices.getUserMedia(constraints);

      // Apply initial mute state
      if (options.inputAudio.inputAudioState.isMuted) {
        _muteAllAudioTracks();
      }

      // Add tracks to peer connection
      for (final track in _localStream!.getTracks()) {
        await _peerConnection!.addTrack(track, _localStream!);
      }
    } catch (e) {
      _handleWebrtcFailure(e);
    }
  }

  Future<void> _setupDataChannels() async {
    if (_peerConnection == null) return;

    try {
      _dataChannel = await _peerConnection!.createDataChannel(
        'messages',
        RTCDataChannelInit()..ordered = true,
      );

      _dataChannel!.onMessage = (RTCDataChannelMessage message) {
        // Handle data channel messages if needed
      };
    } catch (e) {
      print('Error setting up data channel: $e');
    }
  }

  void _onSignallingClientConnected() {
    print('DEBUG: StreamingClient._onSignallingClientConnected() - WebSocket is open');
    _initializePeerConnection().then((_) {
      print('DEBUG: Peer connection initialized, now creating offer');
      _createAndSendOffer();
    }).catchError((e) {
      print('ERROR: Failed to initialize peer connection: $e');
      _handleWebrtcFailure(e);
    });
  }

  Future<void> _createAndSendOffer() async {
    if (_peerConnection == null) return;

    print('DEBUG: Creating and sending offer');
    try {
      final offer = await _peerConnection!.createOffer();
      await _peerConnection!.setLocalDescription(offer);
      print('DEBUG: Offer created, sending via signalling client');
      signallingClient.sendOffer(offer);
    } catch (e) {
      print('ERROR: Failed to create/send offer: $e');
      _handleWebrtcFailure(e);
    }
  }

  void _onSignalMessage(SignalMessage message) {
    switch (message.actionType) {
      case SignalMessageAction.answer:
        _handleAnswer(message.payload);
        break;
      case SignalMessageAction.iceCandidate:
        _handleIceCandidate(message.payload);
        break;
      case SignalMessageAction.endSession:
        publicEventEmitter.emitConnectionClosed(
          ConnectionClosedCode.sessionExpired,
          'Session ended by server',
        );
        stopConnection();
        break;
      case SignalMessageAction.sessionReady:
        // Session is ready
        break;
      case SignalMessageAction.warning:
        // Handle warning messages
        break;
      default:
        break;
    }
  }

  Future<void> _handleAnswer(dynamic payload) async {
    if (_peerConnection == null) return;

    try {
      final answer = RTCSessionDescription(
        payload['sdp'] as String,
        payload['type'] as String,
      );
      await _peerConnection!.setRemoteDescription(answer);
      _connectionReceivedAnswer = true;

      // Process buffered ICE candidates
      for (final candidate in _remoteIceCandidateBuffer) {
        await _peerConnection!.addCandidate(candidate);
      }
      _remoteIceCandidateBuffer.clear();
    } catch (e) {
      _handleWebrtcFailure(e);
    }
  }

  Future<void> _handleIceCandidate(dynamic payload) async {
    if (_peerConnection == null) return;

    print('DEBUG: Handling remote ICE candidate: ${payload['candidate']}');
    
    try {
      final candidate = RTCIceCandidate(
        payload['candidate'] as String,
        payload['sdpMid'] as String?,
        payload['sdpMLineIndex'] as int?,
      );

      if (_connectionReceivedAnswer) {
        print('DEBUG: Adding remote ICE candidate immediately');
        await _peerConnection!.addCandidate(candidate);
        print('DEBUG: Successfully added remote ICE candidate');
      } else {
        print('DEBUG: Buffering remote ICE candidate (answer not received yet)');
        _remoteIceCandidateBuffer.add(candidate);
      }
    } catch (e) {
      print('ERROR: Failed to add ICE candidate: $e');
      print('ERROR: Payload was: $payload');
    }
  }


  void _onIceCandidate(RTCIceCandidate? candidate) {
    if (candidate != null) {
      print('DEBUG: Sending ICE candidate: ${candidate.candidate}');
      signallingClient.sendIceCandidate(candidate);
    }
  }

  void _onIceConnectionStateChange(RTCIceConnectionState? state) {
    print('DEBUG: ICE connection state changed to: $state');
    if (state == RTCIceConnectionState.RTCIceConnectionStateConnected ||
        state == RTCIceConnectionState.RTCIceConnectionStateCompleted) {
      print('DEBUG: ICE connection established successfully!');
      publicEventEmitter.emitConnectionEstablished();
    } else if (state == RTCIceConnectionState.RTCIceConnectionStateFailed) {
      print('ERROR: ICE connection failed');
      _handleWebrtcFailure('ICE connection failed');
    }
  }

  void _onConnectionStateChange(RTCPeerConnectionState? state) {
    if (state == RTCPeerConnectionState.RTCPeerConnectionStateClosed) {
      _handleWebrtcFailure('Connection closed');
    }
  }

  void _onTrackEvent(RTCTrackEvent event) {
    print('DEBUG: Received track event - kind: ${event.track.kind}, enabled: ${event.track.enabled}');
    if (event.track.kind == 'video') {
      _startSuccessMetricPolling();
      _remoteVideoStream = event.streams.first;
      
      // Ensure video track is enabled
      for (final track in _remoteVideoStream!.getVideoTracks()) {
        print('DEBUG: Video track id: ${track.id}, enabled: ${track.enabled}');
        track.enabled = true;
      }
      
      publicEventEmitter.emitVideoStreamStarted(_remoteVideoStream!);
    } else if (event.track.kind == 'audio') {
      _remoteAudioStream = event.streams.first;
      
      // Ensure audio tracks are enabled
      for (final track in _remoteAudioStream!.getAudioTracks()) {
        track.enabled = true;
      }
      
      publicEventEmitter.emitAudioStreamStarted(_remoteAudioStream!);
    }
  }

  void _onDataChannel(RTCDataChannel channel) {
    // Handle incoming data channel if needed
  }

  void _startSuccessMetricPolling() {
    if (_successMetricPoller != null || _successMetricFired) return;

    print('DEBUG: Starting success metric polling');
    
    // Timeout after 15 seconds
    Future.delayed(const Duration(milliseconds: successMetricPollingTimeoutMs), () {
      if (!_successMetricFired) {
        print('WARNING: No video frames received after 15 seconds, there may be a problem with the connection.');
        _successMetricPoller?.cancel();
        _successMetricPoller = null;
      }
    });

    _successMetricPoller = Timer.periodic(const Duration(seconds: 1), (_) async {
      if (_peerConnection == null || _successMetricFired) {
        _successMetricPoller?.cancel();
        return;
      }

      try {
        final stats = await _peerConnection!.getStats();
        var foundVideoStats = false;
        for (final stat in stats) {
          if (stat.type == 'inbound-rtp' && stat.values['mediaType'] == 'video') {
            foundVideoStats = true;
            final framesDecoded = stat.values['framesDecoded'] as int?;
            final framesReceived = stat.values['framesReceived'] as int?;
            final framesDropped = stat.values['framesDropped'] as int?;
            final bytesReceived = stat.values['bytesReceived'] as int?;
            
            print('DEBUG: Video stats - framesDecoded: $framesDecoded, framesReceived: $framesReceived, framesDropped: $framesDropped, bytesReceived: $bytesReceived');
            
            if (framesDecoded != null && framesDecoded > 0) {
              print('DEBUG: Video frames are being decoded successfully!');
              _successMetricFired = true;
              publicEventEmitter.emitVideoPlayStarted();
              _successMetricPoller?.cancel();
              break;
            }
          }
        }
        if (!foundVideoStats) {
          print('DEBUG: No video stats found in RTC stats');
        }
      } catch (e) {
        print('Error getting stats: $e');
      }
    });
  }

  void _handleWebrtcFailure(dynamic error) {
    print('WebRTC failure: $error');
    
    ConnectionClosedCode code = ConnectionClosedCode.webrtcFailure;
    if (error.toString().contains('Permission denied')) {
      code = ConnectionClosedCode.microphonePermissionDenied;
    }
    
    publicEventEmitter.emitConnectionClosed(code, error.toString());
    stopConnection();
  }

  void _muteAllAudioTracks() {
    _localStream?.getAudioTracks().forEach((track) {
      track.enabled = false;
    });
  }

  void _unmuteAllAudioTracks() {
    _localStream?.getAudioTracks().forEach((track) {
      track.enabled = true;
    });
  }

  void updateInputAudioState(InputAudioState oldState, InputAudioState newState) {
    if (oldState.isMuted != newState.isMuted) {
      if (newState.isMuted) {
        _muteAllAudioTracks();
      } else {
        _unmuteAllAudioTracks();
      }
    }
  }

  MediaStream? get videoStream => _remoteVideoStream;
  MediaStream? get audioStream => _remoteAudioStream;
}