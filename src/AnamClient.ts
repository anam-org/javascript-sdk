import { DEFAULT_PERSONA_CONFIG } from './lib/constants';
import { ApiClient } from './modules/ApiClient';
import { StreamingClient } from './modules/StreamingClient';
import { PersonaConfig, StartSessionResponse } from './types';
import { AnamClientOptions } from './types/AnamClientOptions';

export default class AnamClient {
  protected sessionToken: string | undefined;
  protected apiKey: string | undefined;

  private sessionId: string | null = null;

  private streamingClient: StreamingClient | null = null;
  private apiClient: ApiClient;

  constructor(sessionToken?: string, options: AnamClientOptions = {}) {
    if (!sessionToken && !options.apiKey) {
      throw new Error('Either sessionToken or apiKey must be provided');
    }
    this.sessionToken = sessionToken;
    this.apiKey = options.apiKey;

    this.apiClient = new ApiClient(sessionToken, options.apiKey, options.api);
  }

  public async startSession(personaConfig?: PersonaConfig): Promise<string> {
    try {
      const config = personaConfig || DEFAULT_PERSONA_CONFIG;
      const response: StartSessionResponse =
        await this.apiClient.startSession(config);
      const {
        sessionId,
        clientConfig,
        engineHost,
        engineProtocol,
        signallingEndpoint,
      } = response;
      const { heartbeatIntervalSeconds, maxWsReconnectionAttempts } =
        clientConfig;
      // create a new streaming client
      this.streamingClient = new StreamingClient(sessionId, {
        signalling: {
          heartbeatIntervalSeconds,
          maxWsReconnectionAttempts,
          url: {
            baseUrl: engineHost,
            protocol: engineProtocol,
            signallingPath: signallingEndpoint,
          },
        },
      });
      this.sessionId = sessionId;
      return sessionId;
    } catch (error) {
      console.error(error); // TODO: remove from package
      throw new Error('Failed to start session');
    }
  }

  public async stream(): Promise<MediaStream[]> {
    if (!this.sessionId || !this.streamingClient) {
      throw new Error(
        'Failed to start stream: session is not started. Have you called startSession?',
      );
    }
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
      this.streamingClient?.startConnection();
    });
  }

  public async streamToVideoAndAudioElements(
    videoElementId: string,
    audioElementId: string,
  ): Promise<void> {
    if (!this.sessionId || !this.streamingClient) {
      throw new Error(
        'Failed to start stream: session is not started. Have you called startSession?',
      );
    }
    this.streamingClient.setMediaStreamTargetsById(
      videoElementId,
      audioElementId,
    );
    this.streamingClient.startConnection();
  }
}
