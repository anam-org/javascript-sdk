export interface ClientToolEvent {
  event_id: string;
  event_type: string;
  data: Record<string, unknown>;
  timestamp: string;
}
