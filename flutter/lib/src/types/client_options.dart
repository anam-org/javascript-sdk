class AnamClientOptions {
  final String? apiKey;
  final bool? disableInputAudio;
  final String? audioDeviceId;
  final ApiOptions? api;
  final MetricsOptions? metrics;

  const AnamClientOptions({
    this.apiKey,
    this.disableInputAudio,
    this.audioDeviceId,
    this.api,
    this.metrics,
  });
}

class ApiOptions {
  final String? baseUrl;
  final String? apiVersion;

  const ApiOptions({
    this.baseUrl,
    this.apiVersion,
  });
}

class MetricsOptions {
  final bool? showPeerConnectionStatsReport;
  final String? peerConnectionStatsReportOutputFormat;

  const MetricsOptions({
    this.showPeerConnectionStatsReport,
    this.peerConnectionStatsReportOutputFormat,
  });
}

class StreamingClientOptions {
  final EngineOptions engine;
  final SignallingOptions signalling;
  final List<Map<String, dynamic>> iceServers;
  final InputAudioOptions inputAudio;
  final MetricsOptions? metrics;

  const StreamingClientOptions({
    required this.engine,
    required this.signalling,
    required this.iceServers,
    required this.inputAudio,
    this.metrics,
  });
}

class EngineOptions {
  final String baseUrl;

  const EngineOptions({
    required this.baseUrl,
  });
}

class SignallingOptions {
  final int? heartbeatIntervalSeconds;
  final int? maxWsReconnectionAttempts;
  final SignallingUrlOptions url;

  const SignallingOptions({
    this.heartbeatIntervalSeconds,
    this.maxWsReconnectionAttempts,
    required this.url,
  });
}

class SignallingUrlOptions {
  final String baseUrl;
  final String? protocol;
  final String? signallingPath;
  final String? port;

  const SignallingUrlOptions({
    required this.baseUrl,
    this.protocol,
    this.signallingPath,
    this.port,
  });
}

class InputAudioOptions {
  final InputAudioState inputAudioState;
  final dynamic userProvidedMediaStream;
  final String? audioDeviceId;
  final bool disableInputAudio;

  const InputAudioOptions({
    required this.inputAudioState,
    this.userProvidedMediaStream,
    this.audioDeviceId,
    required this.disableInputAudio,
  });
}

class InputAudioState {
  final bool isMuted;

  const InputAudioState({required this.isMuted});
}