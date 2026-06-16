/**
 * Per-session options forwarded to session-token creation. Mirrors the
 * `sessionOptions` field accepted by the Anam session-token API.
 *
 * Output dimensions are raw pixels by design — the API speaks pixels, not
 * semantic "portrait"/"landscape". The server is the source of truth for which
 * pairs a given avatar model supports (e.g. Cara 4: `1152x768` or `768x1152`)
 * and rejects unsupported pairs.
 */
export interface SessionOptions {
  /** Encoder quality profile. */
  videoQuality?: 'high' | 'auto';
  /** Output video width in pixels. Must be set together with {@link videoHeight}. */
  videoWidth?: number;
  /** Output video height in pixels. Must be set together with {@link videoWidth}. */
  videoHeight?: number;
}
