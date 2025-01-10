import {
  CoreApiRestClient,
  PublicEventEmitter,
  StreamingClient,
  MessageHistoryClient,
  InternalEventEmitter,
} from './modules';
import { TalkMessageStream } from './types/TalkMessageStream';
import {
  AnamEvent,
  EventCallbacks,
  InputAudioState,
  PersonaConfig,
  StartSessionResponse,
  AnamClientOptions,
  StartSessionOptions,
} from './types';

export default class AnamClient {
  private publicEventEmitter: PublicEventEmitter;
  private internalEventEmitter: InternalEventEmitter;

  protected sessionToken: string | undefined;
  protected apiKey: string | undefined;
  protected messageHistoryClient: MessageHistoryClient;

  private personaConfig: PersonaConfig | undefined;
  private clientOptions: AnamClientOptions | undefined;
  private inputAudioState: InputAudioState = { isMuted: false };

  private sessionId: string | null = null;

  private streamingClient: StreamingClient | null = null;
  private apiClient: CoreApiRestClient;

  private _isStreaming = false;

  constructor(
    sessionToken: string | undefined,
    personaConfig: PersonaConfig,
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

    this.sessionToken = sessionToken;
    this.apiKey = options?.apiKey;
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

  private validateClientConfig(
    sessionToken: string | undefined,
    personaConfig: PersonaConfig,
    options?: AnamClientOptions,
  ): string | undefined {
    // Validate authentication configuration
    if (!sessionToken && !options?.apiKey) {
      return 'Either sessionToken or apiKey must be provided';
    }
    if (options?.apiKey && sessionToken) {
      return 'Only one of sessionToken or apiKey should be used';
    }
    // Validate persona configuration
    if (!personaConfig) {
      return 'Persona configuration must be provided';
    }
    if (personaConfig.personaId === '' || !personaConfig.personaId) {
      return 'Persona ID must be provided in persona configuration';
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
      if (!config) {
        throw new Error(
          'A default persona configuration has not been set and no persona configuration was provided',
        );
      }
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
      throw new Error('Failed to start session');
    }
  }

  private async startSessionIfNeeded(userProvidedMediaStream?: MediaStream) {
    if (!this.sessionId || !this.streamingClient) {
      try {
        await this.startSession(userProvidedMediaStream);
      } catch (error) {
        throw new Error(
          'StreamToVideoAndAudioElements: Failed to start session',
        );
      }
      if (!this.sessionId || !this.streamingClient) {
        throw new Error(
          'StreamToVideoAndAudioElements: session Id or streaming client is not available after starting session',
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
