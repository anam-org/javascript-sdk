export interface SessionReadyPayload {
  // Set by engines that ack talk-stream chunks (ENG-3716). Absent on older engines.
  sendsTalkStreamAcks?: boolean;
}
