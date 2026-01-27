interface SignallingURLOptionsBase {
  protocol?: string;
  port?: string;
  signallingPath?: string;
}

/**
 * Use baseUrl to construct the WebSocket URL from components.
 */
interface SignallingURLOptionsWithBaseUrl extends SignallingURLOptionsBase {
  baseUrl: string;
  absoluteWsUrl?: never;
}

/**
 * Use absoluteWsUrl to provide a complete WebSocket URL directly.
 * Example: wss://example.com/v1/agents/123/ws?engineHost=...&engineProtocol=...&signallingEndpoint=...&session_id=...
 */
interface SignallingURLOptionsWithAbsoluteUrl extends SignallingURLOptionsBase {
  baseUrl?: never;
  absoluteWsUrl: string;
}

/**
 * URL configuration for the signalling client.
 * Either provide `baseUrl` to construct the URL, or `absoluteWsUrl` for a complete URL.
 */
export type SignallingURLOptions =
  | SignallingURLOptionsWithBaseUrl
  | SignallingURLOptionsWithAbsoluteUrl;

export interface SignallingClientOptions {
  heartbeatIntervalSeconds?: number;
  maxWsReconnectionAttempts?: number;
  url: SignallingURLOptions;
}
