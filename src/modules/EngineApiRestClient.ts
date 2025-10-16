import { ProxyConfig } from '../types/ProxyConfig';

export class EngineApiRestClient {
  private baseUrl: string;
  private sessionId: string;
  private proxyConfig: ProxyConfig | undefined;

  constructor(baseUrl: string, sessionId: string, proxyConfig?: ProxyConfig) {
    this.baseUrl = baseUrl;
    this.sessionId = sessionId;
    this.proxyConfig = proxyConfig;
  }

  public async sendTalkCommand(content: string): Promise<void> {
    try {
      // Determine the URL and headers based on proxy configuration
      let url: string;
      let headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const targetPath = `/talk`;
      const queryString = `?session_id=${this.sessionId}`;

      if (this.proxyConfig?.enabled && this.proxyConfig?.engine) {
        // Use proxy base URL with same endpoint path
        url = `${this.proxyConfig.engine}${targetPath}${queryString}`;
        // Add standard forwarding headers
        const targetUrl = new URL(`${this.baseUrl}${targetPath}${queryString}`);
        headers['X-Forwarded-Host'] = targetUrl.host;
        headers['X-Forwarded-Proto'] = targetUrl.protocol.slice(0, -1);
        headers['X-Original-URI'] = `${targetPath}${queryString}`;
        // full original target URL for convenience
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
