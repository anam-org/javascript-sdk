import { Buffer } from 'buffer';
import { ClientError, ErrorCode } from './lib/ClientError';
import {
  ClientMetricMeasurement,
  DEFAULT_ANAM_API_VERSION,
  DEFAULT_ANAM_METRICS_BASE_URL,
  sendClientMetric,
  setClientMetricsBaseUrl,
  setMetricsContext,
} from './lib/ClientMetrics';
import { generateCorrelationId } from './lib/correlationId';
import {
  CoreApiRestClient,
  InternalEventEmitter,
  MessageHistoryClient,
  PublicEventEmitter,
  StreamingClient,
} from './modules';
import {
  AnamClientOptions,
  AnamEvent,
  AudioPermissionState,
  ConnectionClosedCode,
  EventCallbacks,
  InputAudioState,
  PersonaConfig,
  StartSessionOptions,
  StartSessionResponse,
} from './types';
import { TalkMessageStream } from './types/TalkMessageStream';
export default class AnamClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;

  private readonly messageHistoryClient: MessageHistoryClient;

  private personaConfig: PersonaConfig | undefined;
  private clientOptions: AnamClientOptions | undefined;
  private inputAudioState: InputAudioState = {
    isMuted: false,
    permissionState: AudioPermissionState.NOT_REQUESTED,
  };

  private sessionId: string | null = null;
  private organizationId: string | null = null;

  private streamingClient: StreamingClient | null = null;
  private apiClient: CoreApiRestClient;

  private _isStreaming = false;

  constructor(
    sessionToken: string | undefined,
    personaConfig?: PersonaConfig,
    options?: AnamClientOptions,
  ) {
    const configError: string | undefined = this.validateClientConfig(
      sessionToken,
      personaConfig,
      options,
    );
    if (configError) {
      throw new ClientError(
        configError,
        ErrorCode.CLIENT_ERROR_CODE_CONFIGURATION_ERROR,
        400,
      );
    }

    this.personaConfig = personaConfig;
    this.clientOptions = options;

    if (options?.api?.baseUrl || options?.api?.apiVersion) {
      setClientMetricsBaseUrl(
        options.api.baseUrl || DEFAULT_ANAM_METRICS_BASE_URL,
        options.api.apiVersion || DEFAULT_ANAM_API_VERSION,
      );
    }

    this.publicEventEmitter = new PublicEventEmitter();
    this.internalEventEmitter = new InternalEventEmitter();

    this.apiClient = new CoreApiRestClient(
      sessionToken,
      options?.apiKey,
      options?.api,
    );
    this.messageHistoryClient = new MessageHistoryClient(
      this.publicEventEmitter,
      this.internalEventEmitter,
    );
  }

  private decodeJwt(token: string): any {
    try {
      const base64Payload = token.split('.')[1];
      const payloadString = Buffer.from(base64Payload, 'base64').toString(
        'utf8',
      );
      const payload = JSON.parse(payloadString);
      return payload;
    } catch (error) {
      throw new Error('Invalid session token format');
    }
  }

  private validateClientConfig(
    sessionToken: string | undefined,
    personaConfig?: PersonaConfig,
    options?: AnamClientOptions,
  ): string | undefined {
    // Validate authentication configuration
    if (!sessionToken && !options?.apiKey) {
      return 'Either sessionToken or apiKey must be provided';
    }
    if (options?.apiKey && sessionToken) {
      return 'Only one of sessionToken or apiKey should be used';
    }

    // Validate persona configuration based on session token
    if (sessionToken) {
      const decodedToken = this.decodeJwt(sessionToken);
      this.organizationId = decodedToken.accountId;
      setMetricsContext({
        organizationId: this.organizationId,
      });

      const tokenType = decodedToken.type?.toLowerCase();

      if (tokenType === 'legacy') {
        return 'Legacy session tokens are no longer supported. Please define your persona when creating your session token. See https://docs.anam.ai/resources/migrating-legacy for more information.';
      } else if (tokenType === 'ephemeral' || tokenType === 'stateful') {
        if (personaConfig) {
          return 'This session token already contains a persona configuration. Please remove the personaConfig parameter.';
        }
      }
    } else {
      // No session token (using apiKey)
      if (!personaConfig) {
        return 'Missing persona config. Persona configuration must be provided when using apiKey';
      }
    }

    // Validate voice detection configuration
    if (options?.voiceDetection) {
      if (options.disableInputAudio) {
        return 'Voice detection is disabled because input audio is disabled. Please set disableInputAudio to false to enable voice detection.';
      }
      // End of speech sensitivity must be a number between 0 and 1
      if (options.voiceDetection.endOfSpeechSensitivity !== undefined) {
        if (typeof options.voiceDetection.endOfSpeechSensitivity !== 'number') {
          return 'End of speech sensitivity must be a number';
        }
        if (
          options.voiceDetection.endOfSpeechSensitivity < 0 ||
          options.voiceDetection.endOfSpeechSensitivity > 1
        ) {
          return 'End of speech sensitivity must be between 0 and 1';
        }
      }
    }
    return undefined;
  }

  private buildStartSessionOptionsForClient(): StartSessionOptions | undefined {
    const sessionOptions: StartSessionOptions = {};
    if (this.clientOptions?.voiceDetection) {
      sessionOptions.voiceDetection = this.clientOptions.voiceDetection;
    }
    // return undefined if no options are set
    if (Object.keys(sessionOptions).length === 0) {
      return undefined;
    }
    return sessionOptions;
  }

  private async startSession(
    userProvidedAudioStream?: MediaStream,
  ): Promise<string> {
    const config = this.personaConfig;
    // build session options from client options
    const sessionOptions: StartSessionOptions | undefined =
      this.buildStartSessionOptionsForClient();
    // start a new session
    const response: StartSessionResponse = await this.apiClient.startSession(
      config,
      sessionOptions,
    );
    const {
      sessionId,
      clientConfig,
      engineHost,
      engineProtocol,
      signallingEndpoint,
    } = response;
    const { heartbeatIntervalSeconds, maxWsReconnectionAttempts, iceServers } =
      clientConfig;

    this.sessionId = sessionId;
    setMetricsContext({
      sessionId: this.sessionId,
    });

    try {
      this.streamingClient = new StreamingClient(
        sessionId,
        {
          engine: {
            baseUrl: `${engineProtocol}://${engineHost}`,
          },
          signalling: {
            heartbeatIntervalSeconds,
            maxWsReconnectionAttempts,
            url: {
              baseUrl: engineHost,
              protocol: engineProtocol,
              signallingPath: signallingEndpoint,
            },
          },
          iceServers,
          inputAudio: {
            inputAudioState: this.inputAudioState,
            userProvidedMediaStream: this.clientOptions?.disableInputAudio
              ? undefined
              : userProvidedAudioStream,
            audioDeviceId: this.clientOptions?.audioDeviceId,
            disableInputAudio: this.clientOptions?.disableInputAudio,
          },
          metrics: {
            showPeerConnectionStatsReport:
              this.clientOptions?.metrics?.showPeerConnectionStatsReport ??
              false,
            peerConnectionStatsReportOutputFormat:
              this.clientOptions?.metrics
                ?.peerConnectionStatsReportOutputFormat ?? 'console',
          },
        },
        this.publicEventEmitter,
        this.internalEventEmitter,
      );
    } catch (error) {
      setMetricsContext({
        sessionId: null,
      });
      throw new ClientError(
        'Failed to initialize streaming client',
        ErrorCode.CLIENT_ERROR_CODE_SERVER_ERROR,
        500,
        {
          cause: error instanceof Error ? error.message : String(error),
          sessionId,
        },
      );
    }

    return sessionId;
  }

  private async startSessionIfNeeded(userProvidedAudioStream?: MediaStream) {
    if (!this.sessionId || !this.streamingClient) {
      await this.startSession(userProvidedAudioStream);

      if (!this.sessionId || !this.streamingClient) {
        throw new ClientError(
          'Session ID or streaming client is not available after starting session',
          ErrorCode.CLIENT_ERROR_CODE_SERVER_ERROR,
          500,
          {
            cause: 'Failed to initialize session properly',
          },
        );
      }
    }
  }

  public async stream(
    userProvidedAudioStream?: MediaStream,
  ): Promise<MediaStream[]> {
    if (this._isStreaming) {
      throw new Error('Already streaming');
    }
    // generate a new ID here to track the attempt
    const attemptCorrelationId = generateCorrelationId();
    setMetricsContext({
      attemptCorrelationId,
      sessionId: null, // reset sessionId
    });
    sendClientMetric(
      ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_SESSION_ATTEMPT,
      '1',
    );
    if (this.clientOptions?.disableInputAudio && userProvidedAudioStream) {
      console.warn(
        'AnamClient:Input audio is disabled. User provided audio stream will be ignored.',
      );
    }
    await this.startSessionIfNeeded(userProvidedAudioStream);

    this._isStreaming = true;
    return new Promise<MediaStream[]>((resolve) => {
      // set stream callbacks to capture the stream
      const streams: MediaStream[] = [];
      let videoReceived = false;
      let audioReceived = false;
      this.publicEventEmitter.addListener(
        AnamEvent.VIDEO_STREAM_STARTED,
        (videoStream: MediaStream) => {
          streams.push(videoStream);
          videoReceived = true;
          if (audioReceived) {
            resolve(streams);
          }
        },
      );
      this.publicEventEmitter.addListener(
        AnamEvent.AUDIO_STREAM_STARTED,
        (audioStream: MediaStream) => {
          streams.push(audioStream);
          audioReceived = true;
          if (videoReceived) {
            resolve(streams);
          }
        },
      );
      // start streaming
      this.streamingClient?.startConnection();
    });
  }

  /**
   * @deprecated This method is deprecated. Please use streamToVideoElement instead.
   */
  public async streamToVideoAndAudioElements(
    videoElementId: string,
    audioElementId: string,
    userProvidedAudioStream?: MediaStream,
  ): Promise<void> {
    console.warn(
      'AnamClient: streamToVideoAndAudioElements is deprecated. To avoid possible audio issues, please use streamToVideoElement instead.',
    );
    await this.streamToVideoElement(videoElementId, userProvidedAudioStream);
  }

  public async streamToVideoElement(
    videoElementId: string,
    userProvidedAudioStream?: MediaStream,
  ): Promise<void> {
    // generate a new ID here to track the attempt
    const attemptCorrelationId = generateCorrelationId();
    setMetricsContext({
      attemptCorrelationId,
      sessionId: null, // reset sessionId
    });
    sendClientMetric(
      ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_SESSION_ATTEMPT,
      '1',
    );
    if (this.clientOptions?.disableInputAudio && userProvidedAudioStream) {
      console.warn(
        'AnamClient:Input audio is disabled. User provided audio stream will be ignored.',
      );
    }
    try {
      await this.startSessionIfNeeded(userProvidedAudioStream);
    } catch (error) {
      if (error instanceof ClientError) {
        throw error;
      }

      throw new ClientError(
        'Failed to start session',
        ErrorCode.CLIENT_ERROR_CODE_SERVER_ERROR,
        500,
        {
          cause: error instanceof Error ? error.message : String(error),
          sessionId: this.sessionId,
        },
      );
    }

    if (this._isStreaming) {
      throw new Error('Already streaming');
    }
    this._isStreaming = true;
    if (!this.streamingClient) {
      throw new Error('Failed to stream: streaming client is not available');
    }

    this.streamingClient.setMediaStreamTargetById(videoElementId);
    this.streamingClient.startConnection();
  }

  /**
   * Send a talk command to make the persona speak the provided content.
   * @param content - The text content for the persona to speak
   * @throws Error if session is not started or not currently streaming
   */
  public async talk(content: string): Promise<void> {
    if (!this.streamingClient) {
      throw new Error(
        'Failed to send talk command: session is not started. Have you called startSession?',
      );
    }
    if (!this._isStreaming) {
      throw new Error(
        'Failed to send talk command: not currently streaming. Have you called stream?',
      );
    }
    await this.streamingClient.sendTalkCommand(content);
    return;
  }

  /**
   * Send a raw data message through the WebRTC data channel.
   * @param message - The message string to send through the data channel
   * @throws Error if session is not started
   */
  public sendDataMessage(message: string): void {
    if (this.streamingClient) {
      this.streamingClient.sendDataMessage(message);
    } else {
      throw new Error('Failed to send message: session is not started.');
    }
  }

  /**
   * Send a user text message in the active streaming session.
   * @param content - The text message content to send
   * @throws Error if not currently streaming or session is not started
   */
  public sendUserMessage(content: string): void {
    if (!this._isStreaming) {
      console.warn(
        'AnamClient: Not currently streaming. User message will not be sent.',
      );
      throw new Error('Failed to send user message: not currently streaming');
    }

    const sessionId = this.getActiveSessionId();
    if (!sessionId) {
      throw new Error('Failed to send user message: no active session');
    }

    const currentTimestamp = new Date().toISOString().replace('Z', '');
    const body = JSON.stringify({
      content,
      timestamp: currentTimestamp,
      session_id: sessionId,
      message_type: 'speech',
    });

    this.sendDataMessage(body);
  }

  public interruptPersona(): void {
    if (!this._isStreaming) {
      throw new Error(
        'Failed to send interrupt command: not currently streaming',
      );
    }

    const sessionId = this.getActiveSessionId();
    if (!sessionId) {
      throw new Error('Failed to send interrupt command: no active session');
    }

    const body = JSON.stringify({
      message_type: 'interrupt',
      session_id: sessionId,
      timestamp: new Date().toISOString(), // removing Z not needed
    });

    this.sendDataMessage(body);
  }

  public async stopStreaming(): Promise<void> {
    if (this.streamingClient) {
      this.publicEventEmitter.emit(
        AnamEvent.CONNECTION_CLOSED,
        ConnectionClosedCode.NORMAL,
      );
      await this.streamingClient.stopConnection();
      this.streamingClient = null;
      this.sessionId = null;
      setMetricsContext({
        attemptCorrelationId: null,
        sessionId: null,
        organizationId: this.organizationId,
      });
      this._isStreaming = false;
    }
  }

  public isStreaming(): boolean {
    return this._isStreaming;
  }

  public setPersonaConfig(personaConfig: PersonaConfig): void {
    this.personaConfig = personaConfig;
  }

  public getPersonaConfig(): PersonaConfig | undefined {
    return this.personaConfig;
  }

  public getInputAudioState(): InputAudioState {
    if (this.clientOptions?.disableInputAudio) {
      console.warn(
        'AnamClient: Audio state will not be used because input audio is disabled.',
      );
    }
    // if streaming client is available, make sure our state is up to date
    if (this.streamingClient) {
      this.inputAudioState = this.streamingClient.getInputAudioState();
    }
    return this.inputAudioState;
  }
  public muteInputAudio(): InputAudioState {
    if (this.clientOptions?.disableInputAudio) {
      console.warn(
        'AnamClient: Input audio is disabled. Muting input audio will have no effect.',
      );
    }
    if (this.streamingClient && !this.clientOptions?.disableInputAudio) {
      this.inputAudioState = this.streamingClient.muteInputAudio();
    } else {
      this.inputAudioState = {
        ...this.inputAudioState,
        isMuted: true,
      };
    }
    return this.inputAudioState;
  }

  public unmuteInputAudio(): InputAudioState {
    if (this.clientOptions?.disableInputAudio) {
      console.warn(
        'AnamClient: Input audio is disabled. Unmuting input audio will have no effect.',
      );
    }
    if (this.streamingClient && !this.clientOptions?.disableInputAudio) {
      this.inputAudioState = this.streamingClient.unmuteInputAudio();
    } else {
      this.inputAudioState = {
        ...this.inputAudioState,
        isMuted: false,
      };
    }
    return this.inputAudioState;
  }

  public createTalkMessageStream(correlationId?: string): TalkMessageStream {
    if (!this.streamingClient) {
      throw new Error(
        'Failed to start talk message stream: session is not started.',
      );
    }
    if (correlationId && correlationId.trim() === '') {
      throw new Error(
        'Failed to start talk message stream: correlationId is empty',
      );
    }

    return this.streamingClient.startTalkMessageStream(correlationId);
  }

  /**
   * Event handling
   */
  public addListener<K extends AnamEvent>(
    event: K,
    callback: EventCallbacks[K],
  ): void {
    this.publicEventEmitter.addListener(event, callback);
  }

  public removeListener<K extends AnamEvent>(
    event: K,
    callback: EventCallbacks[K],
  ): void {
    this.publicEventEmitter.removeListener(event, callback);
  }

  public getActiveSessionId(): string | null {
    return this.sessionId;
  }
}
