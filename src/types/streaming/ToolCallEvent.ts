export interface ToolCallEvent {
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  timestamp: string;
}
