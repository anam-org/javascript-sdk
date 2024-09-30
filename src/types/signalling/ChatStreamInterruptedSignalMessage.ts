export class ChatStreamInterruptedSignalMessage {
  constructor(public correlationId: string) {
    this.correlationId = correlationId;
  }
}
