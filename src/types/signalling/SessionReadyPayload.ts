export interface SessionReadyPayload {
  // Set by engines that answer heartbeats carrying a seq (ENG-3716). Absent on older engines.
  sendsHeartbeatAcks?: boolean;
}
