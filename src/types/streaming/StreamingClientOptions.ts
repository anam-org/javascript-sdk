import { SignallingClientOptions } from "../signalling";

export interface StreamingClientOptions {
  videoElementId: string;
  audioElementId: string;
  signalling: SignallingClientOptions;
}
