export const PACKED_ALPHA_TRANSPORT = 'packed-alpha-v1' as const;
/** @internal Engine-CPU cookbook-key control; carries the same premultiplied layout as v1. */
export const PACKED_ALPHA_CPU_TRANSPORT = 'packed-alpha-v2' as const;
/**
 * @deprecated V2 now carries premultiplied colour like v1; use PACKED_ALPHA_CPU_TRANSPORT.
 * @internal
 */
export const PACKED_STRAIGHT_ALPHA_TRANSPORT = PACKED_ALPHA_CPU_TRANSPORT;

export type TransparentBackgroundTransport =
  | typeof PACKED_ALPHA_TRANSPORT
  | typeof PACKED_ALPHA_CPU_TRANSPORT;
