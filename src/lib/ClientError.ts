import { ClientMetricMeasurement, sendClientMetric } from './ClientMetrics';

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
    sendClientMetric(
      ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_ERROR,
      code,
      {
        details,
        statusCode,
      },
    );
  }
}
