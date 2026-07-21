/**
 * Client-side chroma-key controls used when `transparentBackground` is on.
 *
 * The defaults are tuned for Anam's generated exact-green avatar rendition.
 * Most applications should not need to change these values.
 */
export interface TransparentBackgroundOptions {
  /**
   * Chroma distance that is treated as fully transparent. Lower values keep
   * more green-adjacent detail; higher values remove more of the backdrop.
   * @default 0.005
   */
  similarity?: number;
  /**
   * Width of the soft transition around the key threshold.
   * @default 0.56
   */
  smoothness?: number;
  /**
   * Strength of guarded green-spill suppression at semi-transparent edges.
   * Set to `0` to use only the exact green-carrier inverse, or `1` for the
   * full clamp. Opaque foreground colours are preserved.
   * @default 1
   */
  spill?: number;
}
