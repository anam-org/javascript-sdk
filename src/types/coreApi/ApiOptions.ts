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
  /**
   * Per-attempt timeout for the session-start request, in milliseconds.
   * If an attempt does not complete within this window it is aborted,
   * which lets the retry policy treat the failure as transient. Set to 0
   * to disable. Defaults to 10000.
   */
  requestTimeoutMs?: number;
}
