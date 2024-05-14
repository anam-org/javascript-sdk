import AnamClient from './AnamClient';
import { AnamPublicClientOptions } from './types/AnamPublicClientOptions';

const createClient = (
  sessionToken?: string,
  options: AnamPublicClientOptions = {},
): AnamClient => {
  return new AnamClient(sessionToken, options);
};

const unsafe_createClientWithApiKey = (
  apiKey: string,
  options: AnamPublicClientOptions = {},
): AnamClient => {
  return new AnamClient(undefined, { ...options, apiKey });
};

export { createClient, unsafe_createClientWithApiKey };
