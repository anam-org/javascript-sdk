import 'package:flutter_webrtc/flutter_webrtc.dart';

enum AnamEvent {
  connectionEstablished,
  connectionClosed,
  sessionStarted,
  videoStreamStarted,
  audioStreamStarted,
  videoPlayStarted,
  agentStartTalking,
  agentStopTalking,
  messageHistoryUpdated,
  error,
  microphonePermissionDenied,
  webSocketOpen,
  webSocketClose,
  signalMessageReceived,
}

enum ConnectionClosedCode {
  normal,
  sessionExpired,
  webrtcFailure,
  signallingFailure,
  microphonePermissionDenied,
  sessionNotFound,
  unknown,
}

class AnamEventData {
  final AnamEvent event;
  final dynamic data;
  final DateTime timestamp;

  AnamEventData({
    required this.event,
    this.data,
  }) : timestamp = DateTime.now();
}

class VideoStreamEventData {
  final MediaStream stream;

  const VideoStreamEventData({required this.stream});
}

class AudioStreamEventData {
  final MediaStream stream;

  const AudioStreamEventData({required this.stream});
}

class ConnectionClosedEventData {
  final ConnectionClosedCode code;
  final String? reason;

  const ConnectionClosedEventData({
    required this.code,
    this.reason,
  });
}

class ErrorEventData {
  final String message;
  final String? code;
  final dynamic details;

  const ErrorEventData({
    required this.message,
    this.code,
    this.details,
  });
}

class MessageHistoryEventData {
  final List<Message> messages;

  const MessageHistoryEventData({required this.messages});
}

class Message {
  final String id;
  final String content;
  final MessageRole role;
  final DateTime timestamp;

  const Message({
    required this.id,
    required this.content,
    required this.role,
    required this.timestamp,
  });
}

enum MessageRole {
  user,
  assistant,
  system,
}