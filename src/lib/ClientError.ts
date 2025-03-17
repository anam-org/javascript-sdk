export enum ErrorCode {
  USAGE_LIMIT_REACHED = 'USAGE_LIMIT_REACHED',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
}

export class ClientError extends Error {
  code: ErrorCode;
  statusCode: number;
  details?: any;

  constructor(message: string, code: ErrorCode, statusCode: number = 500, details?: any) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    
    Object.setPrototypeOf(this, ClientError.prototype);
  }
}

export class UsageLimitReachedError extends ClientError {
  constructor(message: string, details?: any) {
    super(message, ErrorCode.USAGE_LIMIT_REACHED, 429, details);
  }
}
