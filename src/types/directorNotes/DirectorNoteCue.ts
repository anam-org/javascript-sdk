/**
 * Director Note cue tags understood by the engine at runtime.
 *
 * This is a hand-maintained mirror of `_DIRECTOR_NOTE_CUE_PROMPT_NAMES` in
 * `anam-org/anam-engine/anam_engine/director_notes/cues.py`. It intentionally
 * includes cue-only tags that are not accepted as session-start preset styles.
 */
export const DIRECTOR_NOTE_CUE_TAGS = Object.freeze([
  'happy',
  'warm',
  'playful',
  'laughter',
  'curious',
  'supportive',
  'concerned',
  'sad',
  'surprised',
  'angry',
  'distressed',
] as const);

export type DirectorNoteCueTag = (typeof DIRECTOR_NOTE_CUE_TAGS)[number];

/**
 * Timing for a live Director Note cue.
 *
 * Omit both fields to apply the cue immediately. `inSeconds` is a delay from
 * now; `atSeconds` is an absolute offset from the start of persona speech.
 * The two timing modes are mutually exclusive.
 */
export type DirectorNoteCueOptions =
  | {
      inSeconds?: number;
      atSeconds?: never;
    }
  | {
      inSeconds?: never;
      atSeconds: number;
    };
