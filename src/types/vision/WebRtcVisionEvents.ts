// Wire shapes of the vision messages the engine sends on the session data
// channel. They carry structured results only, never frame bytes.

export interface WebRtcNormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebRtcObservedPerson {
  temporary_id?: string;
  bounds?: WebRtcNormalizedRect;
  gaze_direction?: string;
  posture?: string;
  visible_expression?: string;
}

export interface WebRtcObservedEntity {
  label: string;
  bounds?: WebRtcNormalizedRect;
  attributes?: Record<string, string | number | boolean>;
}

export interface WebRtcSourceSceneState {
  source: string;
  captured_at_ms: number;
  analyzed_at_ms: number;
  asset_id?: string;
  summary: string;
  visible_text?: string;
  people?: WebRtcObservedPerson[];
  entities?: WebRtcObservedEntity[];
  changes?: string[];
}

export interface WebRtcVisionSceneState {
  version: number;
  generated_at_ms: number;
  sources: Record<string, WebRtcSourceSceneState>;
  stale: boolean;
}

export interface WebRtcVisionSceneStateUpdatedEvent {
  scene_state: WebRtcVisionSceneState;
  staleness_ms: number;
}

export interface WebRtcVisionStatusChangedEvent {
  timestamp_ms: number;
  sources: Record<string, string>;
  provider_healthy: boolean;
  scene_state_version: number;
}

export interface WebRtcVisionAnalysisCompletedEvent {
  request_id: string;
  sources: Record<string, WebRtcSourceSceneState>;
  answer?: string;
  requested_at_ms: number;
  completed_at_ms: number;
}

export interface WebRtcVisionAnalysisFailedEvent {
  request_id: string;
  error: string;
}

export interface WebRtcVisualSourceFailedEvent {
  source: string;
  timestamp_ms: number;
  stage: string;
  message: string;
}

export interface WebRtcVisionProactiveTriggerEvent {
  trigger_id: string;
  source: string;
  timestamp_ms: number;
  goal: string;
  observation: string;
  scene_state_version: number;
}
