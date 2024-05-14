export enum SignalMessageAction {
  OFFER = 'offer',
  ANSWER = 'answer',
  ICE_CANDIDATE = 'icecandidate',
  END_SESSION = 'endsession',
  HEARTBEAT = 'heartbeat',
}

export interface SignalMessage {
  actionType: SignalMessageAction;
  sessionId: string;
  payload: object;
}
