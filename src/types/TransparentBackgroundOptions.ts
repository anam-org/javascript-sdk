/**
 * Client-side chroma-key controls used when `transparentBackground` is on.
 *
 * The defaults are tuned for Anam's generated motion-safe green/blue avatar
 * renditions and mirror the server-side compatibility key.
 * Most applications should not need to change these values.
 */
export interface TransparentBackgroundOptions {
  /**
   * Normalized RGB distance that is treated as fully transparent. Lower values
   * keep more carrier-adjacent detail; higher values remove more backdrop.
   * @default 0.01
   */
  similarity?: number;
  /**
   * Width of the soft transition around the key threshold.
   * @default 0.44
   */
  smoothness?: number;
  /**
   * Strength of guarded carrier-channel spill suppression at semi-transparent
   * edges. Set to `0` to disable despill or `1` for the full clamp. Opaque
   * foreground colours are preserved.
   * @default 0.5
   */
  spill?: number;
}
