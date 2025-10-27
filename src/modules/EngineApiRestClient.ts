import { ApiGatewayConfig } from '../types/ApiGatewayConfig';

export class EngineApiRestClient {
  private baseUrl: string;
  private sessionId: string;
  private apiGatewayConfig: ApiGatewayConfig | undefined;

  constructor(
    baseUrl: string,
    sessionId: string,
    apiGatewayConfig?: ApiGatewayConfig,
  ) {
    this.baseUrl = baseUrl;
    this.sessionId = sessionId;
    this.apiGatewayConfig = apiGatewayConfig;
  }

  public async sendTalkCommand(content: string): Promise<void> {
    try {
      // Determine the URL and headers based on API Gateway configuration
      let url: string;
      let headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const targetPath = `/talk`;
      const queryString = `?session_id=${this.sessionId}`;

      if (this.apiGatewayConfig?.enabled && this.apiGatewayConfig?.baseUrl) {
        // Use gateway base URL with same endpoint path
        url = `${this.apiGatewayConfig.baseUrl}${targetPath}${queryString}`;
        // Add complete target URL header for gateway routing
        const targetUrl = new URL(`${this.baseUrl}${targetPath}${queryString}`);
        headers['X-Anam-Target-Url'] = targetUrl.href;
      } else {
        // Direct call to Anam engine
        url = `${this.baseUrl}${targetPath}${queryString}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content,
        }),
      });
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
