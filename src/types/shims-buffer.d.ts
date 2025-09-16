declare module 'buffer' {
  // Minimal shim to satisfy TS in browser environments
  export const Buffer: any;
}
