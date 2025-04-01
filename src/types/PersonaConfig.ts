export type PersonaConfig = SavedPersonaConfig | CustomPersonaConfig;

export interface SavedPersonaConfig {
  personaId: string;
  disableBrains?: boolean;
  disableFillerPhrases?: boolean;
}

export interface CustomPersonaConfig {
  name: string;
  avatarId: string;
  voiceId: string;
  brainType: string;
  systemPrompt?: string;
  maxSessionLengthSeconds?: number;
  languageCode?: string;
}

export function isSavedPersonaConfig(
  personaConfig: PersonaConfig,
): personaConfig is SavedPersonaConfig {
  return 'personaId' in personaConfig;
}

export function isCustomPersonaConfig(
  personaConfig: PersonaConfig,
): personaConfig is CustomPersonaConfig {
  return 'brainType' in personaConfig;
}
