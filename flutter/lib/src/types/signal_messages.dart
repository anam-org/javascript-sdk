enum SignalMessageAction {
  offer,
  answer,
  iceCandidate,
  trickleComplete,
  endSession,
  heartbeat,
  talk,
  talkStreamInterrupted,
  mute,
  unmute,
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
      'action_type': _actionTypeToString(actionType),
      'session_id': sessionId,
      if (payload != null) 'payload': payload,
    };
  }

  factory SignalMessage.fromJson(Map<String, dynamic> json) {
    return SignalMessage(
      actionType: _stringToActionType(json['action_type'] as String),
      sessionId: json['session_id'] as String,
      payload: json['payload'],
    );
  }

  static String _actionTypeToString(SignalMessageAction action) {
    switch (action) {
      case SignalMessageAction.offer:
        return 'OFFER';
      case SignalMessageAction.answer:
        return 'ANSWER';
      case SignalMessageAction.iceCandidate:
        return 'ICE_CANDIDATE';
      case SignalMessageAction.trickleComplete:
        return 'TRICKLE_COMPLETE';
      case SignalMessageAction.endSession:
        return 'END_SESSION';
      case SignalMessageAction.heartbeat:
        return 'HEARTBEAT';
      case SignalMessageAction.talk:
        return 'TALK';
      case SignalMessageAction.talkStreamInterrupted:
        return 'TALK_STREAM_INTERRUPTED';
      case SignalMessageAction.mute:
        return 'MUTE';
      case SignalMessageAction.unmute:
        return 'UNMUTE';
    }
  }

  static SignalMessageAction _stringToActionType(String action) {
    switch (action) {
      case 'OFFER':
        return SignalMessageAction.offer;
      case 'ANSWER':
        return SignalMessageAction.answer;
      case 'ICE_CANDIDATE':
        return SignalMessageAction.iceCandidate;
      case 'TRICKLE_COMPLETE':
        return SignalMessageAction.trickleComplete;
      case 'END_SESSION':
        return SignalMessageAction.endSession;
      case 'HEARTBEAT':
        return SignalMessageAction.heartbeat;
      case 'TALK':
        return SignalMessageAction.talk;
      case 'TALK_STREAM_INTERRUPTED':
        return SignalMessageAction.talkStreamInterrupted;
      case 'MUTE':
        return SignalMessageAction.mute;
      case 'UNMUTE':
        return SignalMessageAction.unmute;
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
        'talk_message_stream_id': talkMessageStreamId,
    };
  }
}