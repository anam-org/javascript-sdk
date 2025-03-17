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
  private inputAudioState: InputAudioState = { isMuted: false };

  private sessionId: string | null = null;

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
      throw new Error(configError);
    }

    this.personaConfig = personaConfig;
    this.clientOptions = options;

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
      const payload = JSON.parse(atob(base64Payload));
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
      const tokenType = decodedToken.type?.toLowerCase();

      if (tokenType === 'legacy') {
        if (!personaConfig || !('personaId' in personaConfig)) {
          return 'Both session token and client are missing a persona configuration. Please provide a persona ID of a saved persona in the personaConfig parameter.';
        }
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
    try {
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
      const {
        heartbeatIntervalSeconds,
        maxWsReconnectionAttempts,
        iceServers,
      } = clientConfig;
      // create a new streaming client
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
            userProvidedMediaStream: userProvidedAudioStream,
          },
        },
        this.publicEventEmitter,
        this.internalEventEmitter,
      );
      this.sessionId = sessionId;
      return sessionId;
    } catch (error) {
      console.error('Failed to start session:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to start session: ' + String(error));
    }
  }

  private async startSessionIfNeeded(userProvidedMediaStream?: MediaStream) {
    if (!this.sessionId || !this.streamingClient) {
      try {
        await this.startSession(userProvidedMediaStream);
      } catch (error) {
        console.error('Failed to start session:', error);
        if (error instanceof Error) {
          throw new Error(`Failed to start session: ${error.message}`);
        }
        throw new Error(`Failed to start session: ${String(error)}`);
      }
      if (!this.sessionId || !this.streamingClient) {
        throw new Error(
          'Session ID or streaming client is not available after starting session'
        );
      }
    }
  }

  public async stream(
    userProvidedAudioStream?: MediaStream,
  ): Promise<MediaStream[]> {
    await this.startSessionIfNeeded(userProvidedAudioStream);
    if (this._isStreaming) {
      throw new Error('Already streaming');
    }
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

  public async streamToVideoAndAudioElements(
    videoElementId: string,
    audioElementId: string,
    userProvidedMediaStream?: MediaStream,
  ): Promise<void> {
    await this.startSessionIfNeeded(userProvidedMediaStream);
    if (this._isStreaming) {
      throw new Error('Already streaming');
    }
    this._isStreaming = true;
    if (!this.streamingClient) {
      throw new Error('Failed to stream: streaming client is not available');
    }

    this.streamingClient.setMediaStreamTargetsById(
      videoElementId,
      audioElementId,
    );
    this.streamingClient.startConnection();
  }

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

  public sendDataMessage(message: string): void {
    if (this.streamingClient) {
      this.streamingClient.sendDataMessage(message);
    } else {
      throw new Error('Failed to send message: session is not started.');
    }
  }

  public async stopStreaming(): Promise<void> {
    if (this.streamingClient) {
      this.streamingClient.stopConnection();
      this.streamingClient = null;
      this.sessionId = null;
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
    // if streaming client is available, make sure our state is up to date
    if (this.streamingClient) {
      this.inputAudioState = this.streamingClient.getInputAudioState();
    }
    return this.inputAudioState;
  }
  public muteInputAudio(): InputAudioState {
    if (this.streamingClient) {
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
    if (this.streamingClient) {
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

    console.log(
      'Anam SDK: createTalkMessageStream with correlationId: ',
      correlationId,
    );

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
