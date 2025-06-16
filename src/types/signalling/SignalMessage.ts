export enum SignalMessageAction {
  OFFER = 'offer',
  ANSWER = 'answer',
  ICE_CANDIDATE = 'icecandidate',
  END_SESSION = 'endsession',
  HEARTBEAT = 'heartbeat',
  WARNING = 'warning',
  TALK_STREAM_INTERRUPTED = 'talkinputstreaminterrupted',
  TALK_STREAM_INPUT = 'talkstream',
  SESSION_READY = 'sessionready',
}

export interface SignalMessage {
  actionType: SignalMessageAction;
  sessionId: string;
  payload: object | string;
}
