export class TalkStreamInterruptedSignalMessage {
  constructor(public correlationId: string) {
    this.correlationId = correlationId;
  }
}
