import {
  VISUAL_INPUT_SOURCES,
  VisualInputSource,
} from '../types/vision/VisionInput';

// Screen content needs readable text, so AV1 (with its screen-content tools) is
// preferred and the rest is a fallback order. Camera prefers the codec most
// browsers encode in hardware.
export const SCREEN_CODEC_PREFERENCE = [
  'video/AV1',
  'video/VP9',
  'video/H264',
  'video/VP8',
] as const;
export const CAMERA_CODEC_PREFERENCE = [
  'video/H264',
  'video/VP8',
  'video/VP9',
] as const;

export interface VisualSourceSendProfile {
  contentHint: 'motion' | 'text';
  codecPreference: readonly string[];
  maxFramerate: number;
  maxBitrate: number;
  // Longest edge sent on the wire; larger captures are scaled down by the encoder.
  maxLongEdge: number;
  degradationPreference?: RTCDegradationPreference;
}

export const VISUAL_SOURCE_SEND_PROFILES: Record<
  VisualInputSource,
  VisualSourceSendProfile
> = {
  camera: {
    contentHint: 'motion',
    codecPreference: CAMERA_CODEC_PREFERENCE,
    maxFramerate: 10,
    maxBitrate: 500_000,
    maxLongEdge: 640,
  },
  screen: {
    contentHint: 'text',
    codecPreference: SCREEN_CODEC_PREFERENCE,
    maxFramerate: 5,
    maxBitrate: 2_500_000,
    maxLongEdge: 1920,
    degradationPreference: 'maintain-resolution',
  },
};

export const DEFAULT_CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 15, max: 30 },
};

export const DEFAULT_SCREEN_CONSTRAINTS: DisplayMediaStreamOptions = {
  video: {
    width: { max: 1920 },
    height: { max: 1080 },
    frameRate: { max: 5 },
  },
  audio: false,
};

export interface VisualTrackMapping {
  source: VisualInputSource;
  mid: string;
}

export const isVisualInputSource = (
  value: unknown,
): value is VisualInputSource =>
  typeof value === 'string' &&
  (VISUAL_INPUT_SOURCES as readonly string[]).includes(value);

/**
 * Orders codec capabilities so the preferred codecs come first, in preference
 * order, followed by every other capability (RTX, RED, FEC and anything not
 * listed) in its original order. A preferred codec the browser cannot encode
 * stays where it was, so a missing AV1 encoder falls back cleanly.
 */
export const orderCodecsByPreference = <
  T extends { mimeType: string; sdpFmtpLine?: string },
>(
  codecs: readonly T[],
  preference: readonly string[],
  encodableMimeTypes?: ReadonlySet<string>,
): T[] => {
  const normalized = (mimeType: string) => mimeType.toLowerCase();
  const preferred: T[] = [];
  for (const mimeType of preference) {
    const target = normalized(mimeType);
    if (encodableMimeTypes && !encodableMimeTypes.has(target)) {
      continue;
    }
    for (const codec of codecs) {
      if (normalized(codec.mimeType) === target) {
        preferred.push(codec);
      }
    }
  }
  const rest = codecs.filter((codec) => !preferred.includes(codec));
  return [...preferred, ...rest];
};

export const resolveVisionSources = (
  requested: readonly VisualInputSource[] | undefined,
  screenCaptureSupported: boolean,
): VisualInputSource[] => {
  const sources = requested ?? VISUAL_INPUT_SOURCES;
  return VISUAL_INPUT_SOURCES.filter(
    (source) =>
      sources.includes(source) &&
      (source !== 'screen' || screenCaptureSupported),
  );
};

// Capability detection, not user-agent sniffing: mobile browsers do not expose
// getDisplayMedia.
export const isScreenCaptureSupported = (
  mediaDevices: Partial<MediaDevices> | undefined,
): boolean => typeof mediaDevices?.getDisplayMedia === 'function';

/** The factor that brings the longest edge down to maxLongEdge, never upscaling. */
export const scaleDownFactor = (
  width: number | undefined,
  height: number | undefined,
  maxLongEdge: number,
): number => {
  const longEdge = Math.max(width ?? 0, height ?? 0);
  if (!longEdge || longEdge <= maxLongEdge) {
    return 1;
  }
  return longEdge / maxLongEdge;
};
