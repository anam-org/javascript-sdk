import 'dart:async';
import '../types/events.dart';

class EventEmitter {
  final Map<AnamEvent, StreamController<dynamic>> _controllers = {};
  final Map<AnamEvent, Stream<dynamic>> _streams = {};

  Stream<T> on<T>(AnamEvent event) {
    if (!_streams.containsKey(event)) {
      final controller = StreamController<T>.broadcast();
      _controllers[event] = controller;
      _streams[event] = controller.stream;
    }
    return _streams[event]! as Stream<T>;
  }

  void emit(AnamEvent event, [dynamic data]) {
    final controller = _controllers[event];
    if (controller != null && !controller.isClosed) {
      controller.add(data);
    }
  }

  void dispose() {
    for (final controller in _controllers.values) {
      controller.close();
    }
    _controllers.clear();
    _streams.clear();
  }
}

class PublicEventEmitter extends EventEmitter {
  void emitConnectionEstablished() {
    emit(AnamEvent.connectionEstablished);
  }

  void emitConnectionClosed(ConnectionClosedCode code, [String? reason]) {
    emit(AnamEvent.connectionClosed, ConnectionClosedEventData(
      code: code,
      reason: reason,
    ));
  }

  void emitSessionStarted(String sessionId) {
    emit(AnamEvent.sessionStarted, sessionId);
  }

  void emitVideoStreamStarted(dynamic stream) {
    emit(AnamEvent.videoStreamStarted, VideoStreamEventData(stream: stream));
  }

  void emitAudioStreamStarted(dynamic stream) {
    emit(AnamEvent.audioStreamStarted, AudioStreamEventData(stream: stream));
  }

  void emitVideoPlayStarted() {
    emit(AnamEvent.videoPlayStarted);
  }

  void emitAgentStartTalking() {
    emit(AnamEvent.agentStartTalking);
  }

  void emitAgentStopTalking() {
    emit(AnamEvent.agentStopTalking);
  }

  void emitError(String message, {String? code, dynamic details}) {
    emit(AnamEvent.error, ErrorEventData(
      message: message,
      code: code,
      details: details,
    ));
  }

  void emitMessageHistoryUpdated(List<Message> messages) {
    emit(AnamEvent.messageHistoryUpdated, MessageHistoryEventData(messages: messages));
  }
}

class InternalEventEmitter extends EventEmitter {
  void emitWebSocketOpen() {
    emit(AnamEvent.webSocketOpen);
  }

  void emitWebSocketClose(int? code, String? reason) {
    emit(AnamEvent.webSocketClose, {
      'code': code,
      'reason': reason,
    });
  }

  void emitSignalMessageReceived(dynamic message) {
    emit(AnamEvent.signalMessageReceived, message);
  }
}