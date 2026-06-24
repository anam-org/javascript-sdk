import { DirectorNotes } from './DirectorNotes';

export type PersonaConfig = CustomPersonaConfig;

export interface CustomPersonaConfig {
  personaId: string;
  name: string;
  avatarId: string;
  voiceId: string;
  llmId?: string;
  systemPrompt?: string;
  maxSessionLengthSeconds?: number;
  languageCode?: string;
  /**
   * Director Notes for the session — guides the avatar's performance style and
   * speech-driven motion. Cara 4 avatars only; forwarded unchanged to
   * session-token creation. See {@link DirectorNotes}.
   */
  directorNotes?: DirectorNotes;
}

export function isCustomPersonaConfig(
  personaConfig: PersonaConfig,
): personaConfig is CustomPersonaConfig {
  return 'brainType' in personaConfig || 'llmId' in personaConfig;
}
