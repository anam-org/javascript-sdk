import { CLIENT_METADATA } from './constants';

export const DEFAULT_ANAM_METRICS_BASE_URL = 'https://api.anam.ai';
export const DEFAULT_ANAM_API_VERSION = '/v1';

export enum ClientMetricMeasurement {
  CLIENT_METRIC_MEASUREMENT_ERROR = 'client_error',
  CLIENT_METRIC_MEASUREMENT_CONNECTION_CLOSED = 'client_connection_closed',
  CLIENT_METRIC_MEASUREMENT_CONNECTION_ESTABLISHED = 'client_connection_established',
  CLIENT_METRIC_MEASUREMENT_SESSION_ATTEMPT = 'client_session_attempt',
  CLIENT_METRIC_MEASUREMENT_SESSION_SUCCESS = 'client_session_success',
}

let anamCurrentBaseUrl = DEFAULT_ANAM_METRICS_BASE_URL;
let anamCurrentApiVersion = DEFAULT_ANAM_API_VERSION;

export const setClientMetricsBaseUrl = (
  baseUrl: string,
  apiVersion: string = DEFAULT_ANAM_API_VERSION,
) => {
  anamCurrentBaseUrl = baseUrl;
  anamCurrentApiVersion = apiVersion;
};

export interface AnamMetricsContext {
  sessionId: string | null;
  organizationId: string | null;
  attemptCorrelationId: string | null;
}

let anamMetricsContext: AnamMetricsContext = {
  sessionId: null,
  organizationId: null,
  attemptCorrelationId: null,
};

export const setMetricsContext = (context: Partial<AnamMetricsContext>) => {
  anamMetricsContext = { ...anamMetricsContext, ...context };
};

export const sendClientMetric = async (
  name: string,
  value: string,
  tags?: Record<string, string | number>,
) => {
  try {
    const metricTags: Record<string, string | number> = {
      ...CLIENT_METADATA,
      ...tags,
    };

    // Add session and organization IDs if available
    if (anamMetricsContext.sessionId) {
      metricTags.sessionId = anamMetricsContext.sessionId;
    }
    if (anamMetricsContext.organizationId) {
      metricTags.organizationId = anamMetricsContext.organizationId;
    }
    if (anamMetricsContext.attemptCorrelationId) {
      metricTags.attemptCorrelationId = anamMetricsContext.attemptCorrelationId;
    }

    await fetch(
      `${anamCurrentBaseUrl}${anamCurrentApiVersion}/metrics/client`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          value,
          tags: metricTags,
        }),
      },
    );
  } catch (error) {
    console.error('Failed to send error metric:', error);
  }
};
