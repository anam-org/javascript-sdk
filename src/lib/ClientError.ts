import { CLIENT_METADATA } from './constants';
export enum ErrorCode {
  CLIENT_ERROR_CODE_USAGE_LIMIT_REACHED = 'CLIENT_ERROR_CODE_USAGE_LIMIT_REACHED',
  CLIENT_ERROR_CODE_VALIDATION_ERROR = 'CLIENT_ERROR_CODE_VALIDATION_ERROR',
  CLIENT_ERROR_CODE_AUTHENTICATION_ERROR = 'CLIENT_ERROR_CODE_AUTHENTICATION_ERROR',
  CLIENT_ERROR_CODE_SERVER_ERROR = 'CLIENT_ERROR_CODE_SERVER_ERROR',
  CLIENT_ERROR_CODE_MAX_CONCURRENT_SESSIONS_REACHED = 'CLIENT_ERROR_CODE_MAX_CONCURRENT_SESSIONS_REACHED',
  CLIENT_ERROR_CODE_SERVICE_BUSY = 'CLIENT_ERROR_CODE_SERVICE_BUSY',
  CLIENT_ERROR_CODE_NO_PLAN_FOUND = 'CLIENT_ERROR_CODE_NO_PLAN_FOUND',
  CLIENT_ERROR_CODE_UNKNOWN_ERROR = 'CLIENT_ERROR_CODE_UNKNOWN_ERROR',
  CLIENT_ERROR_CODE_CONFIGURATION_ERROR = 'CLIENT_ERROR_CODE_CONFIGURATION_ERROR',
}

export const DEFAULT_ANAM_METRICS_BASE_URL = 'https://api.anam.ai';
export const DEFAULT_ANAM_API_VERSION = '/v1';

let anamCurrentBaseUrl = DEFAULT_ANAM_METRICS_BASE_URL;
let anamCurrentApiVersion = DEFAULT_ANAM_API_VERSION;

export const setErrorMetricsBaseUrl = (
  baseUrl: string,
  apiVersion: string = DEFAULT_ANAM_API_VERSION,
) => {
  anamCurrentBaseUrl = baseUrl;
  anamCurrentApiVersion = apiVersion;
};

export const sendErrorMetric = async (
  name: string,
  value: string,
  tags?: Record<string, string | number>,
) => {
  try {
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
          tags: {
            ...CLIENT_METADATA,
            ...tags,
          },
        }),
      },
    );
  } catch (error) {
    console.error('Failed to send error metric:', error);
  }
};

export class ClientError extends Error {
  code: ErrorCode;
  statusCode: number;
  details?: any;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 500,
    details?: any,
  ) {
    super(message);
    this.name = 'ClientError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    Object.setPrototypeOf(this, ClientError.prototype);

    // Send error metric when error is created
    sendErrorMetric('client_error', code, {
      details,
      statusCode,
    });
  }
}
