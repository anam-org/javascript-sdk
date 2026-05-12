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
  | 'angry'
  | 'rage';

export type DirectorNotes =
  | {
      presetStyle: DirectorNotesStylePreset;
      customStyle?: never;
      speechAdherence?: number;
      styleAdherence?: number;
    }
  | {
      customStyle: string;
      presetStyle?: never;
      speechAdherence?: number;
      styleAdherence?: number;
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
