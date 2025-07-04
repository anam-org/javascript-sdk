class StartSessionResponse {
  final String sessionId;
  final String engineHost;
  final String engineProtocol;
  final String signallingEndpoint;
  final ClientConfig clientConfig;

  const StartSessionResponse({
    required this.sessionId,
    required this.engineHost,
    required this.engineProtocol,
    required this.signallingEndpoint,
    required this.clientConfig,
  });

  factory StartSessionResponse.fromJson(Map<String, dynamic> json) {
    return StartSessionResponse(
      sessionId: json['sessionId'] as String,
      engineHost: json['engineHost'] as String,
      engineProtocol: json['engineProtocol'] as String,
      signallingEndpoint: json['signallingEndpoint'] as String,
      clientConfig: ClientConfig.fromJson(json['clientConfig'] as Map<String, dynamic>),
    );
  }
}

class ClientConfig {
  final int heartbeatIntervalSeconds;
  final int maxWsReconnectionAttempts;
  final List<Map<String, dynamic>> iceServers;

  const ClientConfig({
    required this.heartbeatIntervalSeconds,
    required this.maxWsReconnectionAttempts,
    required this.iceServers,
  });

  factory ClientConfig.fromJson(Map<String, dynamic> json) {
    return ClientConfig(
      heartbeatIntervalSeconds: json['heartbeatIntervalSeconds'] as int,
      maxWsReconnectionAttempts: json['maxWsReconnectionAttempts'] as int,
      iceServers: (json['iceServers'] as List<dynamic>)
          .map((e) => e as Map<String, dynamic>)
          .toList(),
    );
  }
}