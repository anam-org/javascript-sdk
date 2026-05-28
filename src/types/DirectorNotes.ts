/**
 * Director Notes guide a Cara 4 avatar's performance style and speech-driven
 * motion for a session. They are forwarded unchanged to session-token
 * creation and are only applied on Cara 4 avatars; on older models the server
 * ignores them and the session proceeds without them.
 *
 * `presetStyle` and `customStylePrompt` are mutually exclusive — the exclusive
 * union below enforces that at the type level, so providing both is a compile
 * error. The server remains the source of truth for model-compatibility
 * validation.
 */

/**
 * Built-in performance styles the avatar can follow.
 *
 * Hand-maintained MIRROR of the engine's accepted cue tags
 * (`_DIRECTOR_NOTE_CUE_PROMPT_NAMES` in anam-org/anam-engine
 * `anam_engine/director_notes/cues.py`) — there is no runtime sync, so this can
 * drift. The server ignores unknown styles. Keep in sync with the engine and
 * with the Lab's `PRESET_STYLES` (anam-org/anam-lab) when styles change.
 */
export type PresetStyle =
  | 'happy'
  | 'warm'
  | 'playful'
  | 'laughter'
  | 'curious'
  | 'supportive'
  | 'concerned'
  | 'sad'
  | 'surprised'
  | 'angry'
  | 'distressed';

interface DirectorNotesStrengths {
  /**
   * How strongly the avatar follows the selected style. CFG-style guidance
   * value; 1.0 is the default.
   */
  styleStrength?: number;
  /**
   * How strongly the avatar's motion follows the speech signal. CFG-style
   * guidance value; 1.0 is the default.
   */
  speechMotionStrength?: number;
}

export type DirectorNotes =
  | (DirectorNotesStrengths & {
      /**
       * Built-in performance style for the avatar to follow. Mutually
       * exclusive with `customStylePrompt`.
       */
      presetStyle: PresetStyle;
      customStylePrompt?: never;
    })
  | (DirectorNotesStrengths & {
      /**
       * Free-form performance style prompt for the avatar to follow. Mutually
       * exclusive with `presetStyle`.
       */
      customStylePrompt: string;
      presetStyle?: never;
    });
