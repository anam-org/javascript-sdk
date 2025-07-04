import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../types/signal_messages.dart';
import '../types/client_options.dart';
import '../types/events.dart';
import '../utils/constants.dart';
import 'event_emitter.dart';

class SignallingClient {
  final String sessionId;
  final SignallingOptions options;
  final PublicEventEmitter publicEventEmitter;
  final InternalEventEmitter internalEventEmitter;
  
  late final Uri _url;
  WebSocketChannel? _channel;
  Timer? _heartbeatTimer;
  final List<SignalMessage> _sendingBuffer = [];
  int _wsConnectionAttempts = 0;
  bool _stopSignal = false;

  SignallingClient({
    required this.sessionId,
    required this.options,
    required this.publicEventEmitter,
    required this.internalEventEmitter,
  }) {
    if (sessionId.isEmpty) {
      throw ArgumentError('SignallingClient: sessionId is required');
    }

    final httpProtocol = options.url.protocol ?? 'https';
    final wsProtocol = httpProtocol == 'http' ? 'ws' : 'wss';
    final path = options.url.signallingPath ?? '/ws';
    
    var urlString = '$wsProtocol://${options.url.baseUrl}$path?session_id=$sessionId';
    if (options.url.port != null) {
      urlString = '$wsProtocol://${options.url.baseUrl}:${options.url.port}$path?session_id=$sessionId';
    }
    
    _url = Uri.parse(urlString);
  }

  Future<void> connect() async {
    if (_stopSignal) return;
    
    try {
      _channel = WebSocketChannel.connect(_url);
      
      _channel!.stream.listen(
        _onMessage,
        onDone: _onClose,
        onError: _onError,
      );
      
      // Wait for connection to be established
      await _channel!.ready;
      _onOpen();
      
    } catch (e) {
      _onError(e);
    }
  }

  void stop() {
    _stopSignal = true;
    _closeSocket();
  }

  void sendOffer(RTCSessionDescription localDescription) {
    final offerMessage = SignalMessage(
      actionType: SignalMessageAction.offer,
      sessionId: sessionId,
      payload: {
        'connectionDescription': {
          'type': localDescription.type,
          'sdp': localDescription.sdp,
        },
        'userUid': sessionId,
      },
    );
    _sendSignalMessage(offerMessage);
  }

  void sendIceCandidate(RTCIceCandidate candidate) {
    final iceCandidateMessage = SignalMessage(
      actionType: SignalMessageAction.iceCandidate,
      sessionId: sessionId,
      payload: candidate.toMap(),
    );
    _sendSignalMessage(iceCandidateMessage);
  }

  void sendTalk(String content, {String? talkMessageStreamId}) {
    final talkMessage = SignalMessage(
      actionType: SignalMessageAction.talk,
      sessionId: sessionId,
      payload: TalkMessagePayload(
        content: content,
        talkMessageStreamId: talkMessageStreamId,
      ).toJson(),
    );
    _sendSignalMessage(talkMessage);
  }

  void sendMute() {
    final muteMessage = SignalMessage(
      actionType: SignalMessageAction.mute,
      sessionId: sessionId,
    );
    _sendSignalMessage(muteMessage);
  }

  void sendUnmute() {
    final unmuteMessage = SignalMessage(
      actionType: SignalMessageAction.unmute,
      sessionId: sessionId,
    );
    _sendSignalMessage(unmuteMessage);
  }

  void _sendSignalMessage(SignalMessage message) {
    if (_channel?.closeCode == null) {
      try {
        _channel!.sink.add(jsonEncode(message.toJson()));
      } catch (e) {
        _sendingBuffer.add(message);
      }
    } else {
      _sendingBuffer.add(message);
    }
  }

  void _flushSendingBuffer() {
    while (_sendingBuffer.isNotEmpty) {
      final message = _sendingBuffer.removeAt(0);
      _sendSignalMessage(message);
    }
  }

  void _startHeartbeat() {
    final intervalSeconds = options.heartbeatIntervalSeconds ?? defaultHeartbeatIntervalSeconds;
    _heartbeatTimer?.cancel();
    
    _heartbeatTimer = Timer.periodic(Duration(seconds: intervalSeconds), (_) {
      if (_channel?.closeCode == null) {
        final heartbeatMessage = SignalMessage(
          actionType: SignalMessageAction.heartbeat,
          sessionId: sessionId,
        );
        _sendSignalMessage(heartbeatMessage);
      }
    });
  }

  void _onOpen() {
    _wsConnectionAttempts = 0;
    internalEventEmitter.emitWebSocketOpen();
    _startHeartbeat();
    _flushSendingBuffer();
  }

  void _onMessage(dynamic message) {
    try {
      final data = jsonDecode(message as String) as Map<String, dynamic>;
      final signalMessage = SignalMessage.fromJson(data);
      internalEventEmitter.emitSignalMessageReceived(signalMessage);
    } catch (e) {
      print('Error parsing signal message: $e');
    }
  }

  void _onClose() {
    _heartbeatTimer?.cancel();
    internalEventEmitter.emitWebSocketClose(
      _channel?.closeCode,
      _channel?.closeReason,
    );
    _attemptReconnect();
  }

  void _onError(dynamic error) {
    print('WebSocket error: $error');
    publicEventEmitter.emitError('WebSocket error', details: error);
  }

  void _attemptReconnect() {
    if (_stopSignal) return;
    
    final maxAttempts = options.maxWsReconnectionAttempts ?? defaultWsReconnectionAttempts;
    
    if (_wsConnectionAttempts < maxAttempts) {
      _wsConnectionAttempts++;
      Future.delayed(Duration(seconds: _wsConnectionAttempts), () {
        if (!_stopSignal) {
          connect();
        }
      });
    } else {
      publicEventEmitter.emitConnectionClosed(
        ConnectionClosedCode.signallingFailure,
        'Max reconnection attempts reached',
      );
    }
  }

  void _closeSocket() {
    _heartbeatTimer?.cancel();
    _channel?.sink.close();
    _channel = null;
  }
}