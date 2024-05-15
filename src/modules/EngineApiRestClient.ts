export class EngineApiRestClient {
  protected baseUrl: string;
  protected sessionId: string;

  constructor(baseUrl: string, sessionId: string) {
    this.baseUrl = baseUrl;
    this.sessionId = sessionId;
    console.log('EngineApiRestClient: baseUrl', baseUrl);
  }

  public async sendTalkCommand(content: string): Promise<void> {
    try {
      const response = await fetch(
        `${this.baseUrl}/talk?session_id=${this.sessionId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to send talk command: ${response.status} ${response.statusText}`,
        );
      }
      console.log('EngineApiRestClient - sendTalkCommand: response', response);
    } catch (error) {
      console.error(error);
      throw new Error(
        'EngineApiRestClient - sendTalkCommand: Failed to send talk command',
      );
    }
  }
}
