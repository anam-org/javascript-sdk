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
  AGENT_AUDIO_INPUT = 'agentaudioinput',
  AGENT_AUDIO_INPUT_END = 'agentaudioinputend',
}

export interface SignalMessage {
  actionType: SignalMessageAction;
  sessionId: string;
  payload: object | string;
}
