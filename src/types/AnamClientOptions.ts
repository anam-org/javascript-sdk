import { AnamInternalClientOptions } from './AnamInternalClientOptions';
import { AnamPublicClientOptions } from './AnamPublicClientOptions';

export type AnamClientOptions = AnamPublicClientOptions &
  AnamInternalClientOptions;
