import {
  NormalizedRect,
  SourceSceneState,
  VisionAnalysisResult,
  VisionProactiveTriggerEvent,
  VisionSceneStateUpdatedEvent,
  VisionSourceStatus,
  VisionStatusChangedEvent,
  VisualInputSource,
  VisualSourceFailedEvent,
  VisualSourceFailureStage,
} from '../types/vision/VisionInput';
import {
  WebRtcNormalizedRect,
  WebRtcSourceSceneState,
  WebRtcVisionAnalysisCompletedEvent,
  WebRtcVisionProactiveTriggerEvent,
  WebRtcVisionSceneStateUpdatedEvent,
  WebRtcVisionStatusChangedEvent,
  WebRtcVisualSourceFailedEvent,
} from '../types/vision/WebRtcVisionEvents';
import { isVisualInputSource } from './visualInput';

// Converts engine wire messages (snake_case) into public SDK payloads. Unknown
// sources and statuses are dropped so a newer engine cannot break older SDKs.

const VISION_SOURCE_STATUSES: readonly VisionSourceStatus[] = [
  'inactive',
  'active',
  'stale',
  'failed',
];
const FAILURE_STAGES: readonly VisualSourceFailureStage[] = [
  'capture',
  'transport',
  'decode',
  'analysis',
];

const toRect = (
  rect: WebRtcNormalizedRect | undefined,
): NormalizedRect | undefined =>
  rect
    ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    : undefined;

export const toSourceSceneState = (
  wire: WebRtcSourceSceneState,
): SourceSceneState | null => {
  if (!isVisualInputSource(wire.source)) {
    return null;
  }
  return {
    source: wire.source,
    capturedAtMs: wire.captured_at_ms,
    analyzedAtMs: wire.analyzed_at_ms,
    assetId: wire.asset_id,
    summary: wire.summary,
    visibleText: wire.visible_text,
    people: (wire.people ?? []).map((person) => ({
      temporaryId: person.temporary_id,
      bounds: toRect(person.bounds),
      gazeDirection: person.gaze_direction,
      posture: person.posture,
      visibleExpression: person.visible_expression,
    })),
    entities: (wire.entities ?? []).map((entity) => ({
      label: entity.label,
      bounds: toRect(entity.bounds),
      attributes: entity.attributes,
    })),
    changes: wire.changes ?? [],
  };
};

const toSourceSceneStates = (
  wire: Record<string, WebRtcSourceSceneState> | undefined,
): Partial<Record<VisualInputSource, SourceSceneState>> => {
  const sources: Partial<Record<VisualInputSource, SourceSceneState>> = {};
  for (const sourceState of Object.values(wire ?? {})) {
    const converted = toSourceSceneState(sourceState);
    if (converted) {
      sources[converted.source] = converted;
    }
  }
  return sources;
};

export const toSceneStateUpdatedEvent = (
  wire: WebRtcVisionSceneStateUpdatedEvent,
): VisionSceneStateUpdatedEvent => ({
  sceneState: {
    version: wire.scene_state.version,
    generatedAtMs: wire.scene_state.generated_at_ms,
    sources: toSourceSceneStates(wire.scene_state.sources),
    stale: wire.scene_state.stale,
  },
  stalenessMs: wire.staleness_ms,
});

export const toStatusChangedEvent = (
  wire: WebRtcVisionStatusChangedEvent,
): VisionStatusChangedEvent => {
  const sources: Partial<Record<VisualInputSource, VisionSourceStatus>> = {};
  for (const [source, status] of Object.entries(wire.sources ?? {})) {
    if (
      isVisualInputSource(source) &&
      (VISION_SOURCE_STATUSES as readonly string[]).includes(status)
    ) {
      sources[source] = status as VisionSourceStatus;
    }
  }
  return {
    timestampMs: wire.timestamp_ms,
    sources,
    providerHealthy: wire.provider_healthy,
    sceneStateVersion: wire.scene_state_version,
  };
};

export const toAnalysisResult = (
  wire: WebRtcVisionAnalysisCompletedEvent,
): VisionAnalysisResult => ({
  requestId: wire.request_id,
  sources: toSourceSceneStates(wire.sources),
  answer: wire.answer,
  requestedAtMs: wire.requested_at_ms,
  completedAtMs: wire.completed_at_ms,
});

export const toSourceFailedEvent = (
  wire: WebRtcVisualSourceFailedEvent,
): VisualSourceFailedEvent | null => {
  if (!isVisualInputSource(wire.source)) {
    return null;
  }
  const stage = (FAILURE_STAGES as readonly string[]).includes(wire.stage)
    ? (wire.stage as VisualSourceFailureStage)
    : 'analysis';
  return {
    source: wire.source,
    timestampMs: wire.timestamp_ms,
    stage,
    message: wire.message,
  };
};

export const toProactiveTriggerEvent = (
  wire: WebRtcVisionProactiveTriggerEvent,
): VisionProactiveTriggerEvent | null => {
  if (!isVisualInputSource(wire.source)) {
    return null;
  }
  return {
    triggerId: wire.trigger_id,
    source: wire.source,
    timestampMs: wire.timestamp_ms,
    goal: wire.goal,
    observation: wire.observation,
    sceneStateVersion: wire.scene_state_version,
  };
};
