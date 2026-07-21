import type { DirectorNotes } from './directorNotes';

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
   * Director Notes for the session — a baseline performance style for the
   * avatar and how expressively it is played. Cara 4 avatars only; forwarded
   * unchanged to session-token creation. See {@link DirectorNotes}.
   */
  directorNotes?: DirectorNotes;
}

// Confirmation that a runtime persona config update was applied.
export interface PersonaConfigUpdateAppliedEvent {
  // Changed config path -> { before, after } values.
  changedFields: Record<string, { before?: unknown; after?: unknown }>;
}

export function isCustomPersonaConfig(
  personaConfig: PersonaConfig,
): personaConfig is CustomPersonaConfig {
  return 'brainType' in personaConfig || 'llmId' in personaConfig;
}
