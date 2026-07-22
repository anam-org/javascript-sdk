export const PACKED_ALPHA_TRANSPORT = 'packed-alpha-v1' as const;
export const PACKED_STRAIGHT_ALPHA_TRANSPORT = 'packed-alpha-v2' as const;

export type TransparentBackgroundTransport =
  | typeof PACKED_ALPHA_TRANSPORT
  | typeof PACKED_STRAIGHT_ALPHA_TRANSPORT;
