import { PersonaConfig } from '../types';

// Core API
export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};
export const DEFAULT_API_BASE_URL = 'https://api.anam.ai';
export const DEFAULT_API_VERSION = '/v1'; // include the leading slash

// Engine API
export const DEFAULT_ENGINE_BASE_URL = 'http://localhost:8081';

// Error messages
export const PUBLIC_MESSAGE_ON_SIGNALLING_CLIENT_CONNECTION_FAILURE =
  'There was a problem connecting to our servers. Please try again.';
export const PUBLIC_MESSAGE_ON_WEBRTC_FAILURE =
  'There was an issue connecting to our servers. Please try again.';

// Signalling
export const DEFAULT_ICE_SERVERS = [
  {
    urls: 'stun:stun.relay.metered.ca:80',
  },
];

// Persona
export const DEFAULT_PERSONA_CONFIG: PersonaConfig = {
  personaName: 'eva',
  disableBrains: false,
};
