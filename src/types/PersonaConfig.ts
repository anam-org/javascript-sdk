export type PersonaConfig = CustomPersonaConfig;

export type DirectorNotesStylePreset =
  | 'neutral'
  | 'warm'
  | 'supportive'
  | 'curious'
  | 'serious'
  | 'playful'
  | 'distressed'
  | 'disinterested'
  | 'confident'
  | 'enthusiastic'
  | 'angry';

export type DirectorNotes =
  | {
      presetStyle: DirectorNotesStylePreset;
      customStyle?: never;
      expressivity?: number;
    }
  | {
      customStyle: string;
      presetStyle?: never;
      expressivity?: number;
    };

export interface CustomPersonaConfig {
  personaId: string;
  name: string;
  avatarId: string;
  voiceId: string;
  llmId?: string;
  systemPrompt?: string;
  maxSessionLengthSeconds?: number;
  languageCode?: string;
  directorNotes?: DirectorNotes;
}

export function isCustomPersonaConfig(
  personaConfig: PersonaConfig,
): personaConfig is CustomPersonaConfig {
  return 'brainType' in personaConfig || 'llmId' in personaConfig;
}
