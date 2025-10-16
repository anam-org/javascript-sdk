import { ProxyConfig } from '../types/ProxyConfig';

/**
 * Validates proxy configuration
 * @param proxyConfig - The proxy configuration to validate
 * @returns Error message if invalid, undefined if valid
 */
export function validateProxyConfig(
  proxyConfig: ProxyConfig | undefined,
): string | undefined {
  if (!proxyConfig || !proxyConfig.enabled) {
    return undefined;
  }

  // Validate WebSocket proxy URL protocol
  if (proxyConfig.websocket) {
    try {
      const wsUrl = new URL(proxyConfig.websocket);
      if (wsUrl.protocol !== 'ws:' && wsUrl.protocol !== 'wss:') {
        return `Invalid WebSocket proxy URL: "${proxyConfig.websocket}". WebSocket proxy must use ws:// or wss:// protocol.`;
      }
    } catch (error) {
      return `Invalid WebSocket proxy URL: "${proxyConfig.websocket}". Must be a valid URL.`;
    }
  }

  // Validate API proxy URL (can be relative or absolute)
  if (proxyConfig.api) {
    try {
      // Try to parse as absolute URL
      new URL(proxyConfig.api);
    } catch {
      // Not an absolute URL, must be a relative path starting with /
      if (!proxyConfig.api.startsWith('/')) {
        return `Invalid API proxy URL: "${proxyConfig.api}". Must be an absolute URL (https://...) or a path starting with /.`;
      }
    }
  }

  // Validate Engine proxy URL (can be relative or absolute)
  if (proxyConfig.engine) {
    try {
      // Try to parse as absolute URL
      new URL(proxyConfig.engine);
    } catch {
      // Not an absolute URL, must be a relative path starting with /
      if (!proxyConfig.engine.startsWith('/')) {
        return `Invalid Engine proxy URL: "${proxyConfig.engine}". Must be an absolute URL (https://...) or a path starting with /.`;
      }
    }
  }

  return undefined;
}
