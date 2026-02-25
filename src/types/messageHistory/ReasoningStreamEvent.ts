export interface ReasoningStreamEvent {
  id: string;
  content: string;
  endOfThought: boolean;
  role: string;
  thoughtDuration?: number;
}
