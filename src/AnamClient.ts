import { CoreApiRestClient } from './modules/CoreApiRestClient';
import { StreamingClient } from './modules/StreamingClient';
import {
  ConnectionCallbacks,
  PersonaConfig,
  StartSessionResponse,
} from './types';
import { AnamClientOptions } from './types/AnamClientOptions';

export default class AnamClient {
  protected sessionToken: string | undefined;
  protected apiKey: string | undefined;

  private personaConfig: PersonaConfig | undefined;
  private sessionId: string | null = null;
  private streamingClient: StreamingClient | null = null;
  private apiClient: CoreApiRestClient;
  private _isStreaming = false;

  constructor(
    sessionToken: string | undefined,
    personaConfig: PersonaConfig,
    options?: AnamClientOptions,
  ) {
    if (!sessionToken && !options?.apiKey) {
      throw new Error('Either sessionToken or apiKey must be provided');
    }
    this.sessionToken = sessionToken;
    this.apiKey = options?.apiKey;
    this.personaConfig = personaConfig;

    this.apiClient = new CoreApiRestClient(
      sessionToken,
      options?.apiKey,
      options?.api,
    );
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
      const response: StartSessionResponse =
        await this.apiClient.startSession(config);
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
      this.streamingClient = new StreamingClient(sessionId, {
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
        userProvidedMediaStream: userProvidedAudioStream,
      });
      this.sessionId = sessionId;
      return sessionId;
    } catch (error) {
      throw new Error('Failed to start session');
    }
  }

  private async startSessionIfNeeded(userProvidedMediaStream?: MediaStream) {
    if (!this.sessionId || !this.streamingClient) {
      console.warn(
        'StreamToVideoAndAudioElements: session is not started. starting a new session',
      );
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
    callbacks: ConnectionCallbacks = {},
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

      this.streamingClient?.setOnVideoStreamStartCallback(
        (videoStream: MediaStream) => {
          streams.push(videoStream);
          videoReceived = true;
          if (audioReceived) {
            resolve(streams);
          }
        },
      );
      this.streamingClient?.setOnAudioStreamStartCallback(
        (audioStream: MediaStream) => {
          streams.push(audioStream);
          audioReceived = true;
          if (videoReceived) {
            resolve(streams);
          }
        },
      );
      // start streaming
      this.streamingClient?.startConnection(callbacks);
    });
  }

  public async streamToVideoAndAudioElements(
    videoElementId: string,
    audioElementId: string,
    callbacks: ConnectionCallbacks = {},
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
    this.streamingClient.startConnection(callbacks);
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
}
