/**
 * A message the engine did not confirm receiving. The SDK does not resend it.
 */
export interface MessageDeliveryFailure {
  messageType: 'talkStream';
  /** The talk stream's correlation id. */
  correlationId: string;
}
