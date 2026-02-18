import { ElevenLabsAgentSettings } from './ElevenLabsAgentSettings';

export interface AnamInternalClientOptions {
  apiKey?: string;
  environment?: {
    elevenLabsAgentSettings?: ElevenLabsAgentSettings;
  };
}
