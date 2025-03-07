export class EngineApiRestClient {
  private baseUrl: string;
  private sessionId: string;

  constructor(baseUrl: string, sessionId: string) {
    this.baseUrl = baseUrl;
    this.sessionId = sessionId;
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
    } catch (error) {
      console.error(error);
      throw new Error(
        'EngineApiRestClient - sendTalkCommand: Failed to send talk command',
      );
    }
  }
}
