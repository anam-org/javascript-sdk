import AnamClient from './AnamClient';
import { PersonaConfig } from './types';
import { AnamPublicClientOptions } from './types/AnamPublicClientOptions';

/**
 * Create a new Anam client.
 * @param sessionToken - A session token can be obtained from the Anam API.
 * @param personaConfig - The persona configuration to use.
 * @param options - Additional options.
 * @returns A new Anam client instance.
 */
const createClient = (
  sessionToken: string,
  options?: AnamPublicClientOptions,
): AnamClient => {
  return new AnamClient(sessionToken, undefined, options);
};

/**
 * Create a new Anam client with an API key instead of a session token.
 * This method is unsafe for production environments because it requires exposing your API key to the client side.
 * Only use this method for local testing.
 * @param apiKey - Your Anam API key.
 * @param personaConfig - The persona configuration to use.
 * @param options - Additional options.
 * @returns A new Anam client instance.
 */
const unsafe_createClientWithApiKey = (
  apiKey: string,
  personaConfig: PersonaConfig,
  options?: AnamPublicClientOptions,
): AnamClient => {
  return new AnamClient(undefined, personaConfig, { ...options, apiKey });
};

export { createClient, unsafe_createClientWithApiKey };
export type { AnamClient };
export * from './types';
export { ClientError } from './lib/ClientError';
