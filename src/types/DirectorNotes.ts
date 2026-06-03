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

/**
 * Partial Director Notes update for a LIVE (streaming) session, applied via
 * {@link AnamClient.updateDirectorNotes} over the data channel. All fields are
 * optional — send only what changes.
 *
 * Only Cara 4 avatars support mid-session updates, and the engine applies only
 * `presetStyle` and the strength values live. `presetStyle: null` resets to the
 * session-start style. `customStylePrompt` cannot be changed mid-session (start
 * a new session to change it), so it is intentionally not part of this type.
 * No-op on engines that don't support dynamic updates.
 */
export interface RuntimeDirectorNotes extends DirectorNotesStrengths {
  presetStyle?: PresetStyle | null;
}
