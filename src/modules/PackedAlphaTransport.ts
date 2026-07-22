import { StartSessionOptions } from '../types/coreApi/StartSessionOptions';
import {
  PACKED_ALPHA_CPU_TRANSPORT,
  PACKED_ALPHA_TRANSPORT,
  TransparentBackgroundTransport,
} from '../types/TransparentBackgroundTransport';

const PACKED_ALPHA_DECODING_CONFIGURATION: MediaDecodingConfiguration = {
  type: 'webrtc',
  video: {
    // Match the RTP format we actually negotiate. This is also the form used
    // by the Media Capabilities specification's WebRTC H.264 example.
    contentType:
      'video/H264;level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d0028',
    width: 1152,
    height: 1536,
    bitrate: 2_500_000,
    framerate: 25,
  },
};

type MediaCapabilitiesLike = Pick<MediaCapabilities, 'decodingInfo'>;

/** @internal */
export type PackedAlphaCapability = 'supported' | 'unsupported' | 'unknown';

/**
 * Query support for the H.264 Main Level 4.0 packed-alpha stream.
 * Missing or inconclusive MediaCapabilities implementations are reported as
 * unknown. Callers conservatively retain the legacy carrier in that case: the
 * server requires an explicit Main-Level-4 offer, so guessing support could
 * otherwise turn a graceful quality fallback into a failed session.
 *
 * @internal
 */
export async function detectPackedAlphaCapability(
  mediaCapabilities: MediaCapabilitiesLike | undefined = typeof navigator ===
  'undefined'
    ? undefined
    : navigator.mediaCapabilities,
): Promise<PackedAlphaCapability> {
  if (!mediaCapabilities?.decodingInfo) return 'unknown';

  try {
    const result = await mediaCapabilities.decodingInfo(
      PACKED_ALPHA_DECODING_CONFIGURATION,
    );
    // The packed frame doubles the decoded pixel count. A decoder that can
    // technically accept Main Level 4.0 but is not expected to sustain this
    // configuration should use the lower-resolution compatibility path.
    return result.supported && result.smooth ? 'supported' : 'unsupported';
  } catch {
    // Some browsers expose MediaCapabilities but reject WebRTC configurations.
    // Treat this as inconclusive; the caller keeps the compatibility path.
    return 'unknown';
  }
}

/** @internal */
export async function buildTransparentBackgroundSessionOptions(
  enabled: boolean | undefined,
  mediaCapabilities?: MediaCapabilitiesLike,
): Promise<
  Pick<
    StartSessionOptions,
    'transparentBackground' | 'transparentBackgroundTransport'
  >
> {
  if (enabled === undefined) return {};
  if (!enabled) return { transparentBackground: false };

  const capability = await detectPackedAlphaCapability(mediaCapabilities);
  if (capability !== 'supported') {
    console.warn(
      'Packed transparent-background video support could not be confirmed as smooth on this device; falling back to legacy adaptive chroma keying.',
    );
    return { transparentBackground: true };
  }

  return {
    transparentBackground: true,
    transparentBackgroundTransport: PACKED_ALPHA_TRANSPORT,
  };
}

/**
 * Raise only H.264 Main Level 3.1 payloads to Level 4.0. Other H.264 profiles,
 * codecs and already-higher levels are deliberately left untouched.
 *
 * @internal
 */
export function promotePackedAlphaH264Level(sdp: string): string {
  const h264PayloadTypes = new Set<string>();
  for (const line of sdp.split(/\r?\n/)) {
    const match = line.match(/^a=rtpmap:(\d+)\s+H264\/90000(?:\s|$)/i);
    if (match) h264PayloadTypes.add(match[1]);
  }

  return sdp.replace(
    /^a=fmtp:(\d+)(\s+)([^\r\n]*)$/gim,
    (line, payloadType: string, separator: string, parameters: string) => {
      if (!h264PayloadTypes.has(payloadType)) return line;

      const promotedParameters = parameters.replace(
        /(^|;)(\s*profile-level-id\s*=\s*)4d001f(?=\s*(?:;|$))/i,
        (_match, boundary: string, prefix: string) =>
          `${boundary}${prefix}4d0028`,
      );
      return `a=fmtp:${payloadType}${separator}${promotedParameters}`;
    },
  );
}

/** @internal */
export function prepareOfferForTransparentBackgroundTransport(
  offer: RTCSessionDescriptionInit,
  transport: TransparentBackgroundTransport | undefined,
): RTCSessionDescriptionInit {
  if (
    transport !== PACKED_ALPHA_TRANSPORT &&
    transport !== PACKED_ALPHA_CPU_TRANSPORT
  ) {
    return offer;
  }
  if (!offer.sdp) return offer;
  return { ...offer, sdp: promotePackedAlphaH264Level(offer.sdp) };
}
