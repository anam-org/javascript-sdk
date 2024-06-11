import AnamClient from './AnamClient';
import { PersonaConfig } from './types';
import { AnamPublicClientOptions } from './types/AnamPublicClientOptions';

const createClient = (
  sessionToken: string,
  personaConfig: PersonaConfig,
  options?: AnamPublicClientOptions,
): AnamClient => {
  return new AnamClient(sessionToken, personaConfig, options);
};

const unsafe_createClientWithApiKey = (
  apiKey: string,
  personaConfig: PersonaConfig,
  options?: AnamPublicClientOptions,
): AnamClient => {
  return new AnamClient(undefined, personaConfig, { ...options, apiKey });
};

export { createClient, unsafe_createClientWithApiKey };
export type { AnamClient };
