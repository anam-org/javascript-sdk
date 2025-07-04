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
    
    // Don't include port if it's null or empty
    final urlString = options.url.port != null && options.url.port!.isNotEmpty 
      ? '$wsProtocol://${options.url.baseUrl}:${options.url.port}$path?session_id=$sessionId'
      : '$wsProtocol://${options.url.baseUrl}$path?session_id=$sessionId';
    
    _url = Uri.parse(urlString);
    print('DEBUG: Constructed WebSocket URL: $_url');
  }

  Future<void> connect() async {
    if (_stopSignal) return;
    
    print('DEBUG: SignallingClient connecting to: $_url');
    
    try {
      _channel = WebSocketChannel.connect(_url);
      
      // Set up stream listener first
      _channel!.stream.listen(
        _onMessage,
        onDone: _onClose,
        onError: _onError,
        cancelOnError: false,  // Don't cancel on error
      );
      
      // Wait for connection to be established
      await _channel!.ready;
      print('DEBUG: WebSocket ready, calling _onOpen');
      _onOpen();
      
    } catch (e) {
      print('DEBUG: WebSocket connection error: $e');
      _onError(e);
    }
  }

  void stop() {
    _stopSignal = true;
    _closeSocket();
  }

  void sendOffer(RTCSessionDescription localDescription) {
    print('DEBUG: sendOffer called with type: ${localDescription.type}');
    print('DEBUG: WebSocket state - channel: $_channel, closeCode: ${_channel?.closeCode}');
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
    print('DEBUG: Sending offer message via WebSocket');
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

  void sendTalkMessage(String content, {String? talkMessageStreamId}) {
    final talkMessage = SignalMessage(
      actionType: SignalMessageAction.talkStreamInput,
      sessionId: sessionId,
      payload: TalkMessagePayload(
        content: content,
        talkMessageStreamId: talkMessageStreamId,
      ).toJson(),
    );
    _sendSignalMessage(talkMessage);
  }

  void _sendSignalMessage(SignalMessage message) {
    print('DEBUG: _sendSignalMessage called with action: ${message.actionType}');
    if (_channel?.closeCode == null) {
      try {
        final jsonMessage = jsonEncode(message.toJson());
        print('DEBUG: Sending message over WebSocket: ${jsonMessage.substring(0, 100)}...');
        _channel!.sink.add(jsonMessage);
        print('DEBUG: Message sent successfully');
      } catch (e) {
        print('ERROR: Failed to send message, adding to buffer: $e');
        _sendingBuffer.add(message);
      }
    } else {
      print('DEBUG: WebSocket is closed (code: ${_channel?.closeCode}), adding message to buffer');
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
    print('DEBUG: WebSocket connected successfully');
    _wsConnectionAttempts = 0;
    internalEventEmitter.emitWebSocketOpen();
    _startHeartbeat();
    _flushSendingBuffer();
  }

  void _onMessage(dynamic message) {
    print('DEBUG: Received WebSocket message: $message');
    try {
      final data = jsonDecode(message as String) as Map<String, dynamic>;
      final signalMessage = SignalMessage.fromJson(data);
      print('DEBUG: Parsed signal message with action: ${signalMessage.actionType}');
      internalEventEmitter.emitSignalMessageReceived(signalMessage);
    } catch (e) {
      print('ERROR: Failed to parse signal message: $e');
      print('ERROR: Raw message was: $message');
    }
  }

  void _onClose() {
    print('DEBUG: WebSocket closed with code: ${_channel?.closeCode}, reason: ${_channel?.closeReason}');
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