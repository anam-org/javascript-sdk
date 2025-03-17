export enum ErrorCode {
  USAGE_LIMIT_REACHED = 'USAGE_LIMIT_REACHED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  MAX_CONCURRENT_SESSIONS_REACHED = 'MAX_CONCURRENT_SESSIONS_REACHED',
  SERVICE_BUSY = 'SERVICE_BUSY',
  NO_PLAN_FOUND = 'NO_PLAN_FOUND',
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
  }
}
