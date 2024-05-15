import { DEFAULT_PERSONA_CONFIG } from './lib/constants';
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

  private sessionId: string | null = null;

  private streamingClient: StreamingClient | null = null;
  private apiClient: CoreApiRestClient;
  private _isStreaming = false;

  constructor(sessionToken?: string, options: AnamClientOptions = {}) {
    if (!sessionToken && !options.apiKey) {
      throw new Error('Either sessionToken or apiKey must be provided');
    }
    this.sessionToken = sessionToken;
    this.apiKey = options.apiKey;

    this.apiClient = new CoreApiRestClient(
      sessionToken,
      options.apiKey,
      options.api,
    );
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
      });
      this.sessionId = sessionId;
      return sessionId;
    } catch (error) {
      console.error(error); // TODO: remove from package
      throw new Error('Failed to start session');
    }
  }

  public async stream(
    callbacks: ConnectionCallbacks = {},
  ): Promise<MediaStream[]> {
    if (!this.sessionId || !this.streamingClient) {
      throw new Error(
        'Failed to start stream: session is not started. Have you called startSession?',
      );
    }
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
  ): Promise<void> {
    if (!this.sessionId || !this.streamingClient) {
      throw new Error(
        'Failed to start stream: session is not started. Have you called startSession?',
      );
    }
    if (this._isStreaming) {
      throw new Error('Already streaming');
    }
    this._isStreaming = true;

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
    const response = await this.streamingClient.sendTalkCommand(content);
    console.log('Talk response:', JSON.stringify(response));
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
      console.log('Streaming stopped.');
      this._isStreaming = false;
    } else {
      console.warn('No streams running to stop.');
    }
  }

  public isStreaming(): boolean {
    return this._isStreaming;
  }
}
