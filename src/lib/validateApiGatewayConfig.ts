import { ApiGatewayConfig } from '../types/ApiGatewayConfig';

/**
 * Validates API Gateway configuration
 * @param apiGatewayConfig - The API Gateway configuration to validate
 * @returns Error message if invalid, undefined if valid
 */
export function validateApiGatewayConfig(
  apiGatewayConfig: ApiGatewayConfig | undefined,
): string | undefined {
  if (!apiGatewayConfig || !apiGatewayConfig.enabled) {
    return undefined;
  }

  if (!apiGatewayConfig.baseUrl) {
    return 'API Gateway baseUrl is required when enabled';
  }

  // Validate baseUrl format
  try {
    const url = new URL(apiGatewayConfig.baseUrl);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
      return `Invalid API Gateway baseUrl protocol: ${url.protocol}. Must be http:, https:, ws:, or wss:`;
    }
  } catch (error) {
    return `Invalid API Gateway baseUrl: ${apiGatewayConfig.baseUrl}`;
  }

  // Validate wsPath if provided
  if (apiGatewayConfig.wsPath) {
    if (!apiGatewayConfig.wsPath.startsWith('/')) {
      return 'API Gateway wsPath must start with /';
    }
  }

  return undefined;
}
