export type PersonaConfig = CustomPersonaConfig;

export interface CustomPersonaConfig {
  personaId: string;
  name: string;
  avatarId: string;
  voiceId: string;
  brainType: string;
  systemPrompt?: string;
  maxSessionLengthSeconds?: number;
  languageCode?: string;
}

export function isCustomPersonaConfig(
  personaConfig: PersonaConfig,
): personaConfig is CustomPersonaConfig {
  return 'brainType' in personaConfig;
}
