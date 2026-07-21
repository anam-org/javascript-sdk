/**
 * Director Notes guide a Cara 4 avatar's performance for a session — a
 * baseline style plus how expressively it is played. They are forwarded
 * unchanged to session-token creation and are only applied on Cara 4 avatars;
 * on older models the server ignores them and the session proceeds without
 * them.
 *
 * `presetStyle` and `customStylePrompt` are mutually exclusive — the exclusive
 * union below enforces that at the type level, so providing both is a compile
 * error. The server remains the source of truth for validation (including
 * model compatibility).
 */

/**
 * Built-in performance styles the avatar can follow.
 *
 * Hand-maintained mirror of the Lab's public `PRESET_STYLES`
 * (`anam-org/anam-lab`, `src/lib/types/director-notes.ts`). Runtime cue-only
 * tags are intentionally excluded because the session-token API rejects them
 * as presets. Keep this union in sync when the public preset set changes.
 */
export type PresetStyle =
  | 'happy'
  | 'warm'
  | 'playful'
  | 'supportive'
  | 'sad'
  | 'angry'
  | 'distressed';

interface DirectorNotesExpressivity {
  /**
   * How expressively the style is played, normalized to the range 0–1. Lower
   * values are steadier; higher values increase style and speech-driven
   * motion together. Omit to use the engine default.
   */
  expressivity?: number;
}

export type DirectorNotes =
  | (DirectorNotesExpressivity & {
      /**
       * Built-in performance style for the avatar to follow. Mutually
       * exclusive with `customStylePrompt`.
       */
      presetStyle: PresetStyle;
      customStylePrompt?: never;
    })
  | (DirectorNotesExpressivity & {
      /**
       * Free-form performance style prompt for the avatar to follow (max
       * 2000 characters). Mutually exclusive with `presetStyle`.
       */
      customStylePrompt: string;
      presetStyle?: never;
    })
  | {
      /**
       * How expressively the avatar's default style is played, normalized to
       * the range 0–1. Lower values are steadier; higher values increase
       * style and speech-driven motion together.
       */
      expressivity: number;
      presetStyle?: never;
      customStylePrompt?: never;
    };
