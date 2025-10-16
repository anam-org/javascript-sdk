/**
 * Configuration for proxying SDK requests through a custom proxy server.
 *
 * When enabled, the SDK will route HTTP REST calls and WebSocket signalling
 * through the specified proxy base URLs while maintaining the same endpoint paths.
 * WebRTC peer connections remain direct.
 *
 * @remarks
 * - Proxy is opt-in and disabled by default
 * - Proxy base URLs replace Anam's base URLs, but paths remain the same
 * - Original target info passed via standard forwarding headers (X-Forwarded-Host, X-Forwarded-Proto, X-Original-URI)
 * - Also includes X-Anam-Target-Url for convenience
 *
 * @example
 * ```typescript
 * const client = createClient(sessionToken, {
 *   proxy: {
 *     enabled: true,
 *     api: 'https://my-proxy.com',      // Proxies to api.anam.ai
 *     engine: 'https://my-proxy.com',   // Proxies to engine servers
 *     websocket: 'wss://my-proxy.com'   // Proxies WebSocket connections
 *   }
 * });
 * ```
 */
export interface ProxyConfig {
  /**
   * Enable or disable proxy routing
   */
  enabled: boolean;

  /**
   * Proxy base URL for Anam API requests (session creation, auth)
   * Replaces https://api.anam.ai base URL
   *
   * @example 'https://my-proxy.com' or '/api/proxy' for same-origin
   */
  api?: string;

  /**
   * Proxy base URL for Engine API requests (talk commands, etc.)
   * Replaces the engine server base URL.
   * The original engine base url is dynamic for each session.
   * The forwarding headers can be used to construct the full original target URL.
   *
   * @example 'https://my-proxy.com' or '/api/proxy' for same-origin
   */
  engine?: string;

  /**
   * Proxy base URL for WebSocket signalling connections
   * Replaces the engine WebSocket base URL.
   * The original WebSocket base url is dynamic for each session.
   * The websocket query parameters can be used to construct the full original target URL.
   *
   * @example 'wss://my-proxy.com' or 'ws://localhost:3000/api/proxy'
   */
  websocket?: string;
}
