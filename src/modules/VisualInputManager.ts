import { ClientError, ErrorCode } from '../lib/ClientError';
import { generateCorrelationId } from '../lib/correlationId';
import {
  DEFAULT_CAMERA_CONSTRAINTS,
  DEFAULT_SCREEN_CONSTRAINTS,
  isScreenCaptureSupported,
  orderCodecsByPreference,
  resolveVisionSources,
  scaleDownFactor,
  VISUAL_SOURCE_SEND_PROFILES,
  VisualTrackMapping,
} from '../lib/visualInput';
import {
  toAnalysisResult,
  toProactiveTriggerEvent,
  toSceneStateUpdatedEvent,
  toSourceFailedEvent,
  toStatusChangedEvent,
} from '../lib/visionWire';
import { AnamEvent, DataChannelMessage } from '../types';
import {
  CameraInputOptions,
  ScreenInputOptions,
  VisionAnalysisRequest,
  VisionAnalysisResult,
  VisionClientOptions,
  VisualInputSource,
  VisualSourceStoppedReason,
} from '../types/vision/VisionInput';
import {
  WebRtcVisionAnalysisCompletedEvent,
  WebRtcVisionAnalysisFailedEvent,
  WebRtcVisionProactiveTriggerEvent,
  WebRtcVisionSceneStateUpdatedEvent,
  WebRtcVisionStatusChangedEvent,
  WebRtcVisualSourceFailedEvent,
} from '../types/vision/WebRtcVisionEvents';
import { PublicEventEmitter } from './PublicEventEmitter';

const DEFAULT_ANALYSIS_TIMEOUT_MS = 20_000;
const MAX_ANALYSIS_GOAL_LENGTH = 500;

interface ActiveVisualSource {
  track: MediaStreamTrack;
  // Tracks the SDK captured itself are stopped with the source; tracks from a
  // caller-provided stream belong to the caller.
  ownsTrack: boolean;
  onEnded: () => void;
}

interface PendingAnalysis {
  resolve: (result: VisionAnalysisResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type VisionDataChannelSender = (message: string) => boolean;

/**
 * Owns the pre-negotiated camera and screen transceivers. Tracks are attached
 * and detached with replaceTrack, so starting, replacing or stopping a source
 * never renegotiates and never moves a source to a different MID.
 */
export class VisualInputManager {
  private readonly sources: VisualInputSource[];
  private readonly transceivers = new Map<
    VisualInputSource,
    RTCRtpTransceiver
  >();
  private readonly active = new Map<VisualInputSource, ActiveVisualSource>();
  private readonly pendingAnalyses = new Map<string, PendingAnalysis>();

  constructor(
    private readonly options: VisionClientOptions,
    private readonly publicEventEmitter: PublicEventEmitter,
    private readonly sendDataMessage: VisionDataChannelSender,
    private readonly getSessionId: () => string | null,
  ) {
    this.sources = resolveVisionSources(
      options.sources,
      isScreenCaptureSupported(globalThis.navigator?.mediaDevices),
    );
  }

  /** Adds one send-only video transceiver per source. Call before the first offer. */
  public attach(peerConnection: RTCPeerConnection): void {
    for (const source of this.sources) {
      const profile = { ...VISUAL_SOURCE_SEND_PROFILES[source], ...(source === 'camera' && this.options.cameraFrameRate === 25 ? {maxFramerate:25, maxBitrate:1500000} : {}) };
      const transceiver = peerConnection.addTransceiver('video', {
        direction: 'sendonly',
        sendEncodings: [
          {
            maxFramerate: profile.maxFramerate,
            maxBitrate: profile.maxBitrate,
          },
        ],
      });
      applyCodecPreference(transceiver, profile.codecPreference);
      this.transceivers.set(source, transceiver);
    }
  }

  /** Source-to-MID mapping. MIDs exist only after setLocalDescription. */
  public getTrackMappings(): VisualTrackMapping[] {
    const mappings: VisualTrackMapping[] = [];
    this.transceivers.forEach((transceiver, source) => {
      if (transceiver.mid !== null) {
        mappings.push({ source, mid: transceiver.mid });
      }
    });
    return mappings;
  }

  public async startCamera(options: CameraInputOptions = {}): Promise<void> {
    const transceiver = this.requireTransceiver('camera');
    const { track, ownsTrack } = await this.acquireTrack(
      'camera',
      options.stream,
      () =>
        globalThis.navigator.mediaDevices.getUserMedia({
          video: options.constraints ?? DEFAULT_CAMERA_CONSTRAINTS,
          audio: false,
        }),
    );
    await this.attachTrack('camera', transceiver, track, ownsTrack);
  }

  public async startScreenCapture(
    options: ScreenInputOptions = {},
  ): Promise<void> {
    if (
      !options.stream &&
      !isScreenCaptureSupported(globalThis.navigator?.mediaDevices)
    ) {
      throw new ClientError(
        'Screen capture is not supported on this device',
        ErrorCode.CLIENT_ERROR_CODE_UNSUPPORTED_CAPABILITY,
        400,
      );
    }
    const transceiver = this.requireTransceiver('screen');
    const { track, ownsTrack } = await this.acquireTrack(
      'screen',
      options.stream,
      () =>
        globalThis.navigator.mediaDevices.getDisplayMedia(
          options.constraints ?? DEFAULT_SCREEN_CONSTRAINTS,
        ),
    );
    await this.attachTrack('screen', transceiver, track, ownsTrack);
  }

  public async stopSource(
    source: VisualInputSource,
    reason: VisualSourceStoppedReason = 'stopped_by_client',
  ): Promise<void> {
    const current = this.active.get(source);
    if (!current) {
      return;
    }
    this.active.delete(source);
    this.releaseTrack(current);
    const transceiver = this.transceivers.get(source);
    try {
      await transceiver?.sender.replaceTrack(null);
    } catch (error) {
      // The peer connection may already be closed; the source is stopped either way.
      console.warn(`VisualInputManager - stopSource(${source}):`, error);
    }
    this.sendSourceState(source, 'inactive', reason);
    this.publicEventEmitter.emit(AnamEvent.VISUAL_SOURCE_STOPPED, {
      source,
      timestampMs: Date.now(),
      reason,
    });
  }

  public isSourceActive(source: VisualInputSource): boolean {
    return this.active.has(source);
  }

  public requestAnalysis(
    request: VisionAnalysisRequest = {},
  ): Promise<VisionAnalysisResult> {
    const sources =
      request.sources ??
      this.sources.filter((source) => this.active.has(source));
    if (sources.length === 0) {
      return Promise.reject(
        new Error(
          'Failed to request vision analysis: no visual source is active',
        ),
      );
    }
    const inactive = sources.filter((source) => !this.active.has(source));
    if (inactive.length > 0) {
      return Promise.reject(
        new Error(
          `Failed to request vision analysis: source not active: ${inactive.join(', ')}`,
        ),
      );
    }
    if (
      request.goal !== undefined &&
      request.goal.length > MAX_ANALYSIS_GOAL_LENGTH
    ) {
      return Promise.reject(
        new Error(
          `Failed to request vision analysis: goal must not exceed ${MAX_ANALYSIS_GOAL_LENGTH} characters`,
        ),
      );
    }

    const requestId = generateCorrelationId();
    const timeoutMs = request.timeoutMs ?? DEFAULT_ANALYSIS_TIMEOUT_MS;
    return new Promise<VisionAnalysisResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAnalyses.delete(requestId);
        reject(new Error('Vision analysis timed out'));
      }, timeoutMs);
      this.pendingAnalyses.set(requestId, { resolve, reject, timer });
      const sent = this.sendDataMessage(
        JSON.stringify({
          message_type: 'vision_analysis_request',
          session_id: this.getSessionId(),
          request_id: requestId,
          sources,
          ...(request.goal !== undefined ? { goal: request.goal } : {}),
          timestamp_ms: Date.now(),
        }),
      );
      if (!sent) {
        clearTimeout(timer);
        this.pendingAnalyses.delete(requestId);
        reject(
          new Error(
            'Failed to request vision analysis: data channel is not open',
          ),
        );
      }
    });
  }

  /** Re-announces active sources, e.g. once the session data channel opens. */
  public onDataChannelOpen(): void {
    this.active.forEach((current, source) => {
      this.sendSourceState(source, 'active', undefined, current.track);
    });
  }

  /** Returns true when the message was a vision message. */
  public handleDataChannelMessage(
    messageType: DataChannelMessage,
    data: unknown,
  ): boolean {
    switch (messageType) {
      case DataChannelMessage.VISION_STATUS_CHANGED:
        this.publicEventEmitter.emit(
          AnamEvent.VISION_STATUS_CHANGED,
          toStatusChangedEvent(data as WebRtcVisionStatusChangedEvent),
        );
        return true;
      case DataChannelMessage.VISION_SCENE_STATE_UPDATED:
        this.publicEventEmitter.emit(
          AnamEvent.VISION_SCENE_STATE_UPDATED,
          toSceneStateUpdatedEvent(data as WebRtcVisionSceneStateUpdatedEvent),
        );
        return true;
      case DataChannelMessage.VISION_ANALYSIS_COMPLETED: {
        const result = toAnalysisResult(
          data as WebRtcVisionAnalysisCompletedEvent,
        );
        this.settleAnalysis(result.requestId, (pending) =>
          pending.resolve(result),
        );
        this.publicEventEmitter.emit(
          AnamEvent.VISION_ANALYSIS_COMPLETED,
          result,
        );
        return true;
      }
      case DataChannelMessage.VISION_ANALYSIS_FAILED: {
        const failure = data as WebRtcVisionAnalysisFailedEvent;
        this.settleAnalysis(failure.request_id, (pending) =>
          pending.reject(new Error(`Vision analysis failed: ${failure.error}`)),
        );
        return true;
      }
      case DataChannelMessage.VISUAL_SOURCE_FAILED: {
        const failed = toSourceFailedEvent(
          data as WebRtcVisualSourceFailedEvent,
        );
        if (failed) {
          this.publicEventEmitter.emit(AnamEvent.VISUAL_SOURCE_FAILED, failed);
        }
        return true;
      }
      case DataChannelMessage.VISION_PROACTIVE_TRIGGER: {
        const trigger = toProactiveTriggerEvent(
          data as WebRtcVisionProactiveTriggerEvent,
        );
        if (trigger) {
          this.publicEventEmitter.emit(
            AnamEvent.VISION_PROACTIVE_TRIGGER,
            trigger,
          );
        }
        return true;
      }
      default:
        return false;
    }
  }

  /** Stops every source and rejects pending analyses. The manager is unusable afterwards. */
  public shutdown(): void {
    this.active.forEach((current, source) => {
      this.releaseTrack(current);
      this.publicEventEmitter.emit(AnamEvent.VISUAL_SOURCE_STOPPED, {
        source,
        timestampMs: Date.now(),
        reason: 'connection_closed',
      });
    });
    this.active.clear();
    this.transceivers.clear();
    this.pendingAnalyses.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error('Vision analysis cancelled: session ended'));
    });
    this.pendingAnalyses.clear();
  }

  private requireTransceiver(source: VisualInputSource): RTCRtpTransceiver {
    const transceiver = this.transceivers.get(source);
    if (!transceiver) {
      throw new ClientError(
        `Visual source "${source}" was not negotiated. Enable it in the client's vision options and start streaming first.`,
        ErrorCode.CLIENT_ERROR_CODE_CONFIGURATION_ERROR,
        400,
      );
    }
    return transceiver;
  }

  private async acquireTrack(
    source: VisualInputSource,
    stream: MediaStream | undefined,
    capture: () => Promise<MediaStream>,
  ): Promise<{ track: MediaStreamTrack; ownsTrack: boolean }> {
    let captured: MediaStream;
    try {
      captured = stream ?? (await capture());
    } catch (error) {
      this.emitCaptureFailure(source, error);
      throw error;
    }
    const track = captured.getVideoTracks()[0];
    if (!track) {
      const error = new Error(`The ${source} stream has no video track`);
      this.emitCaptureFailure(source, error);
      throw error;
    }
    return { track, ownsTrack: stream === undefined };
  }

  private async attachTrack(
    source: VisualInputSource,
    transceiver: RTCRtpTransceiver,
    track: MediaStreamTrack,
    ownsTrack: boolean,
  ): Promise<void> {
    const profile = { ...VISUAL_SOURCE_SEND_PROFILES[source], ...(source === 'camera' && this.options.cameraFrameRate === 25 ? {maxFramerate:25, maxBitrate:1500000} : {}) };
    if ('contentHint' in track) {
      track.contentHint = profile.contentHint;
    }
    try {
      await transceiver.sender.replaceTrack(track);
    } catch (error) {
      if (ownsTrack) {
        track.stop();
      }
      this.emitCaptureFailure(source, error);
      throw error;
    }
    await applySendParameters(transceiver.sender, track, profile);

    // A replaced track keeps the transceiver and MID; only the old track is released.
    const previous = this.active.get(source);
    if (previous && previous.track !== track) {
      this.releaseTrack(previous);
    }
    const onEnded = () => {
      // Fired when the user stops sharing from browser chrome or the device goes away.
      if (this.active.get(source)?.track === track) {
        void this.stopSource(source, 'track_ended');
      }
    };
    track.addEventListener('ended', onEnded);
    this.active.set(source, { track, ownsTrack, onEnded });

    this.sendSourceState(source, 'active', undefined, track);
    const settings = track.getSettings();
    this.publicEventEmitter.emit(AnamEvent.VISUAL_SOURCE_STARTED, {
      source,
      timestampMs: Date.now(),
      width: settings.width,
      height: settings.height,
      frameRate: settings.frameRate,
    });
  }

  private releaseTrack(current: ActiveVisualSource): void {
    current.track.removeEventListener('ended', current.onEnded);
    if (current.ownsTrack) {
      current.track.stop();
    }
  }

  private sendSourceState(
    source: VisualInputSource,
    state: 'active' | 'inactive',
    reason?: VisualSourceStoppedReason,
    track?: MediaStreamTrack,
  ): void {
    const settings = track?.getSettings();
    // Control state only; frames travel on the RTP track, never on this channel.
    this.sendDataMessage(
      JSON.stringify({
        message_type: 'visual_source_state',
        session_id: this.getSessionId(),
        source,
        state,
        ...(reason !== undefined ? { reason } : {}),
        ...(settings?.width !== undefined ? { width: settings.width } : {}),
        ...(settings?.height !== undefined ? { height: settings.height } : {}),
        ...(settings?.frameRate !== undefined
          ? { frame_rate: settings.frameRate }
          : {}),
        timestamp_ms: Date.now(),
      }),
    );
  }

  private emitCaptureFailure(source: VisualInputSource, error: unknown): void {
    this.publicEventEmitter.emit(AnamEvent.VISUAL_SOURCE_FAILED, {
      source,
      timestampMs: Date.now(),
      stage: 'capture',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private settleAnalysis(
    requestId: string,
    settle: (pending: PendingAnalysis) => void,
  ): void {
    const pending = this.pendingAnalyses.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingAnalyses.delete(requestId);
    settle(pending);
  }
}

const applyCodecPreference = (
  transceiver: RTCRtpTransceiver,
  preference: readonly string[],
): void => {
  // Read through globalThis: these constructors are missing in some runtimes.
  const receiver = globalThis.RTCRtpReceiver;
  const sender = globalThis.RTCRtpSender;
  if (
    typeof transceiver.setCodecPreferences !== 'function' ||
    typeof receiver?.getCapabilities !== 'function'
  ) {
    return;
  }
  const receiverCodecs = receiver.getCapabilities('video')?.codecs;
  if (!receiverCodecs?.length) {
    return;
  }
  // Prefer only codecs this browser can also encode, so a missing AV1 encoder
  // falls through to the next codec instead of failing negotiation.
  const senderCodecs = sender?.getCapabilities?.('video')?.codecs;
  const encodable = senderCodecs
    ? new Set(senderCodecs.map((codec) => codec.mimeType.toLowerCase()))
    : undefined;
  try {
    transceiver.setCodecPreferences(
      orderCodecsByPreference(receiverCodecs, preference, encodable),
    );
  } catch (error) {
    // Keep the browser's default order rather than failing the connection.
    console.warn('VisualInputManager - setCodecPreferences failed:', error);
  }
};

const applySendParameters = async (
  sender: RTCRtpSender,
  track: MediaStreamTrack,
  profile: (typeof VISUAL_SOURCE_SEND_PROFILES)[VisualInputSource],
): Promise<void> => {
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) {
    return;
  }
  const settings = track.getSettings();
  parameters.encodings = parameters.encodings.map((encoding) => ({
    ...encoding,
    maxFramerate: profile.maxFramerate,
    maxBitrate: profile.maxBitrate,
    scaleResolutionDownBy: scaleDownFactor(
      settings.width,
      settings.height,
      profile.maxLongEdge,
    ),
  }));
  if (profile.degradationPreference) {
    (
      parameters as RTCRtpSendParameters & {
        degradationPreference?: RTCDegradationPreference;
      }
    ).degradationPreference = profile.degradationPreference;
  }
  try {
    await sender.setParameters(parameters);
  } catch (error) {
    // Some browsers reject degradationPreference; the encoding limits matter more.
    console.warn('VisualInputManager - setParameters failed:', error);
  }
};
