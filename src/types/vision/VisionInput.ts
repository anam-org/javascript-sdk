export const VISUAL_INPUT_SOURCES = ['camera', 'screen'] as const;

export type VisualInputSource = (typeof VISUAL_INPUT_SOURCES)[number];

/**
 * Enables Anam vision analysis for the session. The SDK pre-negotiates one
 * send-only video transceiver per source when the peer connection is created,
 * so camera and screen capture can start and stop later without renegotiation.
 * Vision is turnkey-only and must also be enabled for the session server-side.
 */
export interface VisionClientOptions {
  /**
   * Sources to pre-negotiate. Defaults to both. A `screen` source is skipped on
   * browsers that cannot capture the screen (mobile).
   */
  sources?: VisualInputSource[];
}

export interface CameraInputOptions {
  /** An existing stream whose first video track is sent. Its tracks are not stopped by the SDK. */
  stream?: MediaStream;
  /** Constraints passed to getUserMedia when no stream is given. */
  constraints?: MediaTrackConstraints;
}

export interface ScreenInputOptions {
  /** An existing stream whose first video track is sent. Its tracks are not stopped by the SDK. */
  stream?: MediaStream;
  /** Options passed to getDisplayMedia when no stream is given. */
  constraints?: DisplayMediaStreamOptions;
}

export interface VisionAnalysisRequest {
  /** Sources to analyze. Defaults to every active source. */
  sources?: VisualInputSource[];
  /** A short goal for this analysis, e.g. "read the error message on screen". */
  goal?: string;
  /** How long to wait for the result before rejecting. Defaults to 20 seconds. */
  timeoutMs?: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Observable signals only: no identity, protected traits or inferred emotional state. */
export interface ObservedPerson {
  temporaryId?: string;
  bounds?: NormalizedRect;
  gazeDirection?: string;
  posture?: string;
  visibleExpression?: string;
}

export interface ObservedEntity {
  label: string;
  bounds?: NormalizedRect;
  attributes?: Record<string, string | number | boolean>;
}

export interface SourceSceneState {
  source: VisualInputSource;
  capturedAtMs: number;
  analyzedAtMs: number;
  assetId?: string;
  summary: string;
  visibleText?: string;
  people: ObservedPerson[];
  entities: ObservedEntity[];
  changes: string[];
}

export interface VisionSceneState {
  version: number;
  generatedAtMs: number;
  sources: Partial<Record<VisualInputSource, SourceSceneState>>;
  stale: boolean;
}

export interface VisionAnalysisResult {
  requestId: string;
  /** Scene state for the freshly captured frames only. */
  sources: Partial<Record<VisualInputSource, SourceSceneState>>;
  /** Answer to the request goal, when one was given. */
  answer?: string;
  requestedAtMs: number;
  completedAtMs: number;
}

export type VisualSourceStoppedReason =
  | 'stopped_by_client'
  | 'track_ended'
  | 'connection_closed';

export type VisualSourceFailureStage =
  | 'capture'
  | 'transport'
  | 'decode'
  | 'analysis';

export interface VisualSourceStartedEvent {
  source: VisualInputSource;
  timestampMs: number;
  width?: number;
  height?: number;
  frameRate?: number;
}

export interface VisualSourceStoppedEvent {
  source: VisualInputSource;
  timestampMs: number;
  reason: VisualSourceStoppedReason;
}

export interface VisualSourceFailedEvent {
  source: VisualInputSource;
  timestampMs: number;
  stage: VisualSourceFailureStage;
  message: string;
}

export type VisionSourceStatus = 'inactive' | 'active' | 'stale' | 'failed';

export interface VisionStatusChangedEvent {
  timestampMs: number;
  sources: Partial<Record<VisualInputSource, VisionSourceStatus>>;
  /** False while the analysis provider is unavailable; proactive triggers are paused then. */
  providerHealthy: boolean;
  sceneStateVersion: number;
}

export interface VisionSceneStateUpdatedEvent {
  sceneState: VisionSceneState;
  /** Age of the oldest source in the scene state when it was emitted. */
  stalenessMs: number;
}

export interface VisionProactiveTriggerEvent {
  triggerId: string;
  source: VisualInputSource;
  timestampMs: number;
  /** The customer goal that matched. */
  goal: string;
  observation: string;
  sceneStateVersion: number;
}
