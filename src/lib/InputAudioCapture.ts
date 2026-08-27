import {
  ClientMetricMeasurement,
  ClientMetricPayload,
  sendClientMetrics,
} from './ClientMetrics';

type VoiceIsolationMediaTrackConstraints = MediaTrackConstraints & {
  voiceIsolation?: boolean;
};

export type InputAudioCapturePath =
  | 'initial'
  | 'device_change'
  | 'user_provided';

export type InputAudioPlatform = 'ios' | 'android' | 'desktop' | 'unknown';

export type InputAudioBrowser =
  | 'chrome'
  | 'safari'
  | 'firefox'
  | 'edge'
  | 'other';

type AppliedBooleanSetting = 'true' | 'false' | 'unreported';

export interface AppliedInputAudioSettings {
  echoCancellation: AppliedBooleanSetting;
  noiseSuppression: AppliedBooleanSetting;
  autoGainControl: AppliedBooleanSetting;
  voiceIsolation: AppliedBooleanSetting;
  channelCount: number | 'unreported';
}

type SendMetrics = (metrics: ClientMetricPayload[]) => Promise<void>;

interface NavigatorAudioPlatformInfo {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

interface ReportInputAudioSettingsOptions {
  platform?: InputAudioPlatform;
  browser?: InputAudioBrowser;
  sendMetrics?: SendMetrics;
}

/**
 * Build a fresh constraint object for every microphone request so callers can
 * add a device without mutating the defaults used by subsequent captures.
 */
export const buildInputAudioConstraints = (
  deviceId?: string,
): MediaTrackConstraints => {
  const constraints: VoiceIsolationMediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    voiceIsolation: true,
    channelCount: { ideal: 1 },
  };

  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }

  return constraints;
};

export const detectInputAudioPlatform = (
  navigatorInfo: NavigatorAudioPlatformInfo | undefined = typeof navigator ===
  'undefined'
    ? undefined
    : navigator,
): InputAudioPlatform => {
  if (!navigatorInfo) {
    return 'unknown';
  }

  const userAgent = navigatorInfo.userAgent ?? '';
  if (/android/i.test(userAgent)) {
    return 'android';
  }

  const isIosUserAgent = /iPad|iPhone|iPod/i.test(userAgent);
  const isIpadDesktopMode =
    navigatorInfo.platform === 'MacIntel' &&
    (navigatorInfo.maxTouchPoints ?? 0) > 1;
  if (isIosUserAgent || isIpadDesktopMode) {
    return 'ios';
  }

  return 'desktop';
};

// Order matters: Edge UAs contain "Chrome", and Chromium UAs contain "Safari".
export const detectInputAudioBrowser = (
  navigatorInfo: NavigatorAudioPlatformInfo | undefined = typeof navigator ===
  'undefined'
    ? undefined
    : navigator,
): InputAudioBrowser => {
  const userAgent = navigatorInfo?.userAgent ?? '';
  if (/(Edg|EdgiOS|EdgA)\//i.test(userAgent)) {
    return 'edge';
  }
  if (/(Firefox|FxiOS)\//i.test(userAgent)) {
    return 'firefox';
  }
  if (/(Chrome|CriOS)\//i.test(userAgent)) {
    return 'chrome';
  }
  if (/Safari\//i.test(userAgent)) {
    return 'safari';
  }
  return 'other';
};

export const serializeAppliedInputAudioSettings = (
  settings: MediaTrackSettings,
): AppliedInputAudioSettings => {
  const values = settings as unknown as Record<string, unknown>;

  return {
    echoCancellation: normalizeEchoCancellation(values.echoCancellation),
    noiseSuppression: normalizeBooleanSetting(values.noiseSuppression),
    autoGainControl: normalizeBooleanSetting(values.autoGainControl),
    voiceIsolation: normalizeBooleanSetting(values.voiceIsolation),
    channelCount:
      typeof values.channelCount === 'number' &&
      Number.isFinite(values.channelCount)
        ? values.channelCount
        : 'unreported',
  };
};

/**
 * Reports what the browser actually applied. This is deliberately best-effort
 * and must never interfere with attaching the microphone track.
 */
export const reportInputAudioSettings = (
  track: MediaStreamTrack,
  capturePath: InputAudioCapturePath,
  options: ReportInputAudioSettingsOptions = {},
): void => {
  let settings: MediaTrackSettings = {};
  try {
    settings = track.getSettings();
  } catch {
    // Report unreported values when a browser cannot expose track settings.
  }

  const fields = serializeAppliedInputAudioSettings(settings);
  const platform = options.platform ?? detectInputAudioPlatform();
  const browser = options.browser ?? detectInputAudioBrowser();
  const sendMetrics = options.sendMetrics ?? sendClientMetrics;

  try {
    void sendMetrics([
      {
        name: ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_INPUT_AUDIO_SETTINGS,
        value: capturePath,
        tags: { platform, browser },
        fields: { ...fields },
      },
    ]).catch(() => {
      // Client telemetry is non-critical and must not affect the session.
    });
  } catch {
    // Protect the media path from synchronous test doubles or custom fetches.
  }
};

const normalizeBooleanSetting = (value: unknown): AppliedBooleanSetting => {
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  return 'unreported';
};

const normalizeEchoCancellation = (value: unknown): AppliedBooleanSetting => {
  if (value === 'all' || value === 'remote-only') {
    return 'true';
  }
  return normalizeBooleanSetting(value);
};
