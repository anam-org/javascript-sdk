/**
 * Configuration for routing SDK requests through an API Gateway.
 *
 * When enabled, the SDK will route HTTP REST calls and WebSocket signalling
 * through the specified API Gateway while maintaining direct WebRTC peer connections.
 *
 * @remarks
 * - API Gateway is opt-in and disabled by default
 * - The SDK passes complete target URLs to the gateway via headers/query params
 * - The gateway handles routing and forwarding to Anam's infrastructure
 * - WebRTC peer connections remain direct (not routed through gateway)
 *
 * @example
 * ```typescript
 * const client = createClient(sessionToken, {
 *   apiGateway: {
 *     enabled: true,
 *     baseUrl: 'https://my-gateway.com',  // Base URL for all gateway requests
 *     wsPath: '/ws'                        // WebSocket endpoint path (default: '/ws')
 *   }
 * });
 * ```
 */
export interface ApiGatewayConfig {
  /**
   * Enable or disable API Gateway routing
   */
  enabled: boolean;

  /**
   * Base URL of the API Gateway server
   * Used for both HTTP and WebSocket connections
   *
   * @example 'https://my-gateway.com' or 'http://localhost:3001'
   */
  baseUrl: string;

  /**
   * WebSocket endpoint path on the gateway
   * Defaults to '/ws' if not specified
   *
   * @example '/ws' or '/api/websocket'
   * @default '/ws'
   */
  wsPath?: string;
}
