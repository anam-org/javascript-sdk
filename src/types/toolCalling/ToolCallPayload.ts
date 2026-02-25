// Event payloads
export interface ToolCallStartedPayload {
  eventUid: string;
  toolCallId: string;
  toolName: string;
  toolType: string;
  toolSubtype?: string;
  arguments: Record<string, any>;
  timestamp: string;
  timestampUserAction: string;
  userActionCorrelationId: string;
}

export interface ToolCallCompletedPayload {
  eventUid: string;
  toolCallId: string;
  toolName: string;
  toolType: string;
  toolSubtype?: string;
  result: any;
  executionTime: number; // ms
  timestamp: string;
  timestampUserAction: string;
  userActionCorrelationId: string;
}

export interface ToolCallFailedPayload {
  eventUid: string;
  toolCallId: string;
  toolName: string;
  toolType: string;
  toolSubtype?: string;
  errorMessage: string;
  executionTime: number; // ms
  timestamp: string;
  timestampUserAction: string;
  userActionCorrelationId: string;
}
