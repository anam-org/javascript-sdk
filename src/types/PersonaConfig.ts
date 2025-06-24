export type PersonaConfig = SavedPersonaConfig | CustomPersonaConfig;

export interface SavedPersonaConfig {
  personaId: string;
  disableBrains?: boolean;
  disableFillerPhrases?: boolean;
}

export interface CustomPersonaConfig {
  name: string;
  personaPreset: string;
  brainType?: string;
  llmId?: string;
  systemPrompt?: string;
  personality: string;
  fillerPhrases: string[];
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
  return 'brainType' in personaConfig || 'llmId' in personaConfig;
}
