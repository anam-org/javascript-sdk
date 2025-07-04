enum SignalMessageAction {
  offer,
  answer,
  iceCandidate,
  endSession,
  heartbeat,
  warning,
  talkStreamInterrupted,
  talkStreamInput,
  sessionReady,
}

class SignalMessage {
  final SignalMessageAction actionType;
  final String sessionId;
  final dynamic payload;

  const SignalMessage({
    required this.actionType,
    required this.sessionId,
    this.payload,
  });

  Map<String, dynamic> toJson() {
    return {
      'actionType': _actionTypeToString(actionType),
      'sessionId': sessionId,
      if (payload != null) 'payload': payload,
    };
  }

  factory SignalMessage.fromJson(Map<String, dynamic> json) {
    return SignalMessage(
      actionType: _stringToActionType(json['actionType'] as String),
      sessionId: json['sessionId'] as String,
      payload: json['payload'],
    );
  }

  static String _actionTypeToString(SignalMessageAction action) {
    switch (action) {
      case SignalMessageAction.offer:
        return 'offer';
      case SignalMessageAction.answer:
        return 'answer';
      case SignalMessageAction.iceCandidate:
        return 'icecandidate';
      case SignalMessageAction.endSession:
        return 'endsession';
      case SignalMessageAction.heartbeat:
        return 'heartbeat';
      case SignalMessageAction.warning:
        return 'warning';
      case SignalMessageAction.talkStreamInterrupted:
        return 'talkinputstreaminterrupted';
      case SignalMessageAction.talkStreamInput:
        return 'talkstream';
      case SignalMessageAction.sessionReady:
        return 'sessionready';
    }
  }

  static SignalMessageAction _stringToActionType(String action) {
    switch (action) {
      case 'offer':
        return SignalMessageAction.offer;
      case 'answer':
        return SignalMessageAction.answer;
      case 'icecandidate':
        return SignalMessageAction.iceCandidate;
      case 'endsession':
        return SignalMessageAction.endSession;
      case 'heartbeat':
        return SignalMessageAction.heartbeat;
      case 'warning':
        return SignalMessageAction.warning;
      case 'talkinputstreaminterrupted':
        return SignalMessageAction.talkStreamInterrupted;
      case 'talkstream':
        return SignalMessageAction.talkStreamInput;
      case 'sessionready':
        return SignalMessageAction.sessionReady;
      default:
        throw ArgumentError('Unknown action type: $action');
    }
  }
}

class TalkMessagePayload {
  final String content;
  final String? talkMessageStreamId;

  const TalkMessagePayload({
    required this.content,
    this.talkMessageStreamId,
  });

  Map<String, dynamic> toJson() {
    return {
      'content': content,
      if (talkMessageStreamId != null)
        'talkMessageStreamId': talkMessageStreamId,
    };
  }
}