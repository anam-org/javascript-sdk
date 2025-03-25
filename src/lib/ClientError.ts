export enum ErrorCode {
  CLIENT_ERROR_CODE_USAGE_LIMIT_REACHED = 'CLIENT_ERROR_CODE_USAGE_LIMIT_REACHED',
  CLIENT_ERROR_CODE_VALIDATION_ERROR = 'CLIENT_ERROR_CODE_VALIDATION_ERROR',
  CLIENT_ERROR_CODE_AUTHENTICATION_ERROR = 'CLIENT_ERROR_CODE_AUTHENTICATION_ERROR',
  CLIENT_ERROR_CODE_SERVER_ERROR = 'CLIENT_ERROR_CODE_SERVER_ERROR',
  CLIENT_ERROR_CODE_MAX_CONCURRENT_SESSIONS_REACHED = 'CLIENT_ERROR_CODE_MAX_CONCURRENT_SESSIONS_REACHED',
  CLIENT_ERROR_CODE_SERVICE_BUSY = 'CLIENT_ERROR_CODE_SERVICE_BUSY',
  CLIENT_ERROR_CODE_NO_PLAN_FOUND = 'CLIENT_ERROR_CODE_NO_PLAN_FOUND',
  CLIENT_ERROR_CODE_UNKNOWN_ERROR = 'CLIENT_ERROR_CODE_UNKNOWN_ERROR',
}

// TODO: Move to CoreApiRestClient if we have a pattern for not exposing this
export const sendErrorMetric = async (
  name: string,
  value: string,
  tags?: Record<string, string | number>,
) => {
  try {
    // TODO: Don't send this in dev
    await fetch('https://api.anam.ai/v1/metrics/client', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        value,
        tags,
      }),
    });
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
