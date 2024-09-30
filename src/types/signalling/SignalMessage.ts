export enum SignalMessageAction {
  OFFER = 'offer',
  ANSWER = 'answer',
  ICE_CANDIDATE = 'icecandidate',
  END_SESSION = 'endsession',
  HEARTBEAT = 'heartbeat',
  WARNING = 'warning',
  CHAT_STREAM_INTERRUPTED = 'chatinputstreaminterrupted',
  CHAT_STREAM_INPUT = 'talkstream',
}

export interface SignalMessage {
  actionType: SignalMessageAction;
  sessionId: string;
  payload: object | string;
}
