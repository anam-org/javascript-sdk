import { ClientToolEvent, WebRtcClientToolEvent } from '../types/streaming';

export class ToolCallManager {
  /**
   * Converts a WebRtcClientToolEvent to a ClientToolEvent
   */
  static WebRTCClientToolEventToClientToolEvent(
    webRtcEvent: WebRtcClientToolEvent,
  ): ClientToolEvent {
    return {
      eventUid: webRtcEvent.event_uid,
      sessionId: webRtcEvent.session_id,
      eventName: webRtcEvent.event_name,
      eventData: webRtcEvent.event_data,
      timestamp: webRtcEvent.timestamp,
      timestampUserAction: webRtcEvent.timestamp_user_action,
      userActionCorrelationId: webRtcEvent.user_action_correlation_id,
    };
  }
}
