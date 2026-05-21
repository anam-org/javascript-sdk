// Core API
export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
};

export const DEFAULT_API_BASE_URL = 'https://api.anam.ai';
export const DEFAULT_API_VERSION = '/v1'; // include the leading slash

export const CLIENT_METADATA = {
  client: 'js-sdk',
  version: '0.0.0-automated',
};

// Retry policy for startSession. Applied to transient failures only
// (network errors and 5xx responses); 4xx responses are never retried.
export const DEFAULT_START_SESSION_MAX_ATTEMPTS = 3;
export const DEFAULT_START_SESSION_INITIAL_BACKOFF_MS = 250;
export const DEFAULT_START_SESSION_MAX_BACKOFF_MS = 2000;
// Per-attempt timeout. Without this, a hung connection (no TCP reset)
// would block the retry loop from ever firing.
export const DEFAULT_START_SESSION_REQUEST_TIMEOUT_MS = 10000;
