import 'dart:async';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'modules/core_api_rest_client.dart';
import 'modules/event_emitter.dart';
import 'modules/streaming_client.dart';
import 'types/client_options.dart';
import 'types/events.dart';
import 'types/persona_config.dart';
import 'utils/client_error.dart';

typedef VideoStreamCallback = void Function(MediaStream stream);
typedef AudioStreamCallback = void Function(MediaStream stream);

class AnamClient {
  final String? sessionToken;
  final PersonaConfig? personaConfig;
  final AnamClientOptions? options;
  
  late final CoreApiRestClient _apiClient;
  late final PublicEventEmitter _publicEventEmitter;
  late final InternalEventEmitter _internalEventEmitter;
  
  StreamingClient? _streamingClient;
  String? _sessionId;
  InputAudioState _inputAudioState = const InputAudioState(isMuted: false);
  bool _isStreaming = false;

  AnamClient._({
    this.sessionToken,
    this.personaConfig,
    this.options,
  }) {
    final configError = _validateClientConfig();
    if (configError != null) {
      throw ClientError(
        configError,
        ErrorCode.configurationError,
        400,
      );
    }

    _publicEventEmitter = PublicEventEmitter();
    _internalEventEmitter = InternalEventEmitter();

    _apiClient = CoreApiRestClient(
      sessionToken: sessionToken,
      apiKey: options?.apiKey,
      baseUrl: options?.api?.baseUrl,
      apiVersion: options?.api?.apiVersion,
    );

    // Set initial audio state
    if (options?.disableInputAudio == true) {
      _inputAudioState = const InputAudioState(isMuted: true);
    }
  }

  /// Create a new Anam client with a session token.
  /// 
  /// A session token can be obtained from the Anam API.
  static AnamClient createClient(String sessionToken, [AnamClientOptions? options]) {
    return AnamClient._(
      sessionToken: sessionToken,
      options: options,
    );
  }

  /// Create a new Anam client with an API key instead of a session token.
  /// 
  /// This method is unsafe for production environments because it requires
  /// exposing your API key to the client side. Only use this method for local testing.
  static AnamClient createClientWithApiKey(
    String apiKey,
    PersonaConfig personaConfig, [
    AnamClientOptions? options,
  ]) {
    print('WARNING: Using API key directly is unsafe for production. Use session tokens instead.');
    return AnamClient._(
      personaConfig: personaConfig,
      options: AnamClientOptions(
        apiKey: apiKey,
        disableInputAudio: options?.disableInputAudio,
        audioDeviceId: options?.audioDeviceId,
        api: options?.api,
        metrics: options?.metrics,
      ),
    );
  }

  String? _validateClientConfig() {
    if (sessionToken == null && options?.apiKey == null) {
      return 'Either sessionToken or apiKey must be provided';
    }
    if (sessionToken == null && personaConfig == null) {
      return 'PersonaConfig is required when using API key';
    }
    if (sessionToken != null && options?.apiKey != null) {
      return 'Cannot provide both sessionToken and apiKey';
    }
    return null;
  }

  Future<String> _startSession([MediaStream? userProvidedAudioStream]) async {
    final response = await _apiClient.startSession(
      personaConfig: personaConfig,
    );

    _sessionId = response.sessionId;

    _publicEventEmitter.emitSessionStarted(_sessionId!);

    // Initialize streaming client with correct nested fields
    _streamingClient = StreamingClient(
      sessionId: _sessionId!,
      options: StreamingClientOptions(
        engine: EngineOptions(
          baseUrl: '${response.engineProtocol}://${response.engineHost}',
        ),
        signalling: SignallingOptions(
          heartbeatIntervalSeconds: response.clientConfig.heartbeatIntervalSeconds,
          maxWsReconnectionAttempts: response.clientConfig.maxWsReconnectionAttempts,
          url: SignallingUrlOptions(
            baseUrl: response.engineHost,
            protocol: response.engineProtocol,
            signallingPath: response.signallingEndpoint,
          ),
        ),
        iceServers: response.clientConfig.iceServers,
        inputAudio: InputAudioOptions(
          inputAudioState: _inputAudioState,
          userProvidedMediaStream: userProvidedAudioStream,
          audioDeviceId: options?.audioDeviceId,
          disableInputAudio: options?.disableInputAudio ?? false,
        ),
        metrics: options?.metrics,
      ),
      publicEventEmitter: _publicEventEmitter,
      internalEventEmitter: _internalEventEmitter,
    );

    return _sessionId!;
  }

  Future<void> _startSessionIfNeeded([MediaStream? userProvidedAudioStream]) async {
    if (_sessionId == null || _streamingClient == null) {
      await _startSession(userProvidedAudioStream);
    }
  }

  /// Stream to a video renderer widget.
  /// 
  /// This method starts the streaming session and provides callbacks
  /// for when video and audio streams are available.
  Future<void> streamToWidget({
    required VideoStreamCallback onVideoStream,
    AudioStreamCallback? onAudioStream,
    MediaStream? userProvidedAudioStream,
  }) async {
    if (_isStreaming) {
      throw StateError('Already streaming');
    }

    if (options?.disableInputAudio == true && userProvidedAudioStream != null) {
      print('AnamClient: Input audio is disabled. User provided audio stream will be ignored.');
    }

    await _startSessionIfNeeded(userProvidedAudioStream);
    _isStreaming = true;

    // Listen for streams
    _publicEventEmitter
        .on<VideoStreamEventData>(AnamEvent.videoStreamStarted)
        .listen((data) => onVideoStream(data.stream));

    if (onAudioStream != null) {
      _publicEventEmitter
          .on<AudioStreamEventData>(AnamEvent.audioStreamStarted)
          .listen((data) => onAudioStream(data.stream));
    }

    // Start connection
    await _streamingClient!.startConnection();
  }

  /// Send a talk command to the AI persona.
  Future<void> talk(String content) async {
    if (_streamingClient == null) {
      throw StateError('Session not started. Call streamToWidget first.');
    }
    if (!_isStreaming) {
      throw StateError('Not currently streaming. Call streamToWidget first.');
    }
    _streamingClient!.signallingClient.sendTalk(content);
  }

  /// Stop the current streaming session.
  Future<void> stopStreaming() async {
    if (!_isStreaming) return;

    _isStreaming = false;
    await _streamingClient?.stopConnection();
    _streamingClient = null;
    _sessionId = null;
    
    _publicEventEmitter.emitConnectionClosed(
      ConnectionClosedCode.normal,
      'Streaming stopped by client',
    );
  }

  /// Update the input audio state (mute/unmute).
  void updateInputAudioState(InputAudioState newState) {
    final oldState = _inputAudioState;
    _inputAudioState = newState;
    
    _streamingClient?.updateInputAudioState(oldState, newState);
  }

  /// Get a stream of events from the SDK.
  Stream<T> on<T>(AnamEvent event) => _publicEventEmitter.on<T>(event);

  /// Get the current session ID.
  String? get sessionId => _sessionId;

  /// Check if currently streaming.
  bool get isStreaming => _isStreaming;

  /// Dispose of resources.
  void dispose() {
    stopStreaming();
    _publicEventEmitter.dispose();
    _internalEventEmitter.dispose();
  }
}