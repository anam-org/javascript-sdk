import { ApiGatewayConfig } from '../ApiGatewayConfig';

export interface RetryOptions {
  /**
   * Total attempts including the first one. Set to 1 to disable retries.
   */
  maxAttempts?: number;
  /**
   * Initial backoff delay in milliseconds. Subsequent attempts use
   * exponential backoff with jitter.
   */
  initialBackoffMs?: number;
  /**
   * Cap on the exponential backoff delay in milliseconds.
   */
  maxBackoffMs?: number;
}

export interface ApiOptions {
  baseUrl?: string;
  apiVersion?: string;
  apiGateway?: ApiGatewayConfig;
  /**
   * Retry policy for transient failures when starting a session.
   * Applies to network errors and 5xx responses; 4xx responses are never
   * retried.
   */
  retry?: RetryOptions;
}
