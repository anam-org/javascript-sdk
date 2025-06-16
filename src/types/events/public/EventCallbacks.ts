import { Message, MessageStreamEvent, AnamEvent } from '../../index';

export type EventCallbacks = {
  [AnamEvent.MESSAGE_HISTORY_UPDATED]: (messages: Message[]) => void;
  [AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED]: (
    messageEvent: MessageStreamEvent,
  ) => void;
  [AnamEvent.CONNECTION_ESTABLISHED]: () => void;
  [AnamEvent.CONNECTION_CLOSED]: (reason: string) => void;
  [AnamEvent.INPUT_AUDIO_STREAM_STARTED]: (audioStream: MediaStream) => void;
  [AnamEvent.VIDEO_STREAM_STARTED]: (videoStream: MediaStream) => void;
  [AnamEvent.VIDEO_PLAY_STARTED]: () => void;
  [AnamEvent.AUDIO_STREAM_STARTED]: (audioStream: MediaStream) => void;
  [AnamEvent.TALK_STREAM_INTERRUPTED]: (correlationId: string) => void;
  [AnamEvent.SESSION_READY]: (sessionId: string) => void;
};
