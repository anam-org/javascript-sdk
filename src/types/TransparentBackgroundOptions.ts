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
   * @default 0.02
   */
  similarity?: number;
  /**
   * Width of the soft transition around the key threshold.
   * @default 0.36
   */
  smoothness?: number;
  /**
   * Strength of green-spill suppression at semi-transparent edges.
   * @default 0.45
   */
  spill?: number;
}
