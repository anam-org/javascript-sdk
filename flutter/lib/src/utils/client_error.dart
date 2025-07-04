class ClientError implements Exception {
  final String message;
  final ErrorCode code;
  final int? statusCode;
  final Map<String, dynamic>? details;

  const ClientError(
    this.message,
    this.code, [
    this.statusCode,
    this.details,
  ]);

  @override
  String toString() {
    return 'ClientError: $message (${code.name}, status: $statusCode)';
  }
}

enum ErrorCode {
  configurationError,
  serverError,
  networkError,
  authenticationError,
  permissionDenied,
  invalidInput,
  sessionError,
  webrtcError,
  unknown,
}