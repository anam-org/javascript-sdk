import { ApiGatewayConfig } from '../ApiGatewayConfig';

export interface ApiOptions {
  baseUrl?: string;
  apiVersion?: string;
  apiGateway?: ApiGatewayConfig;
}
