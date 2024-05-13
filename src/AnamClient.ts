import { DEFAULT_URL } from "./lib/constants";
import { AnamClientOptions } from "./types/AnamClientOptions";

export default class AnamClient {
  protected baseUrl: string;
  protected sessionToken: string | undefined;
  protected apiKey: string | undefined;

  constructor(sessionToken?: string, options: AnamClientOptions = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_URL;
    if (!sessionToken && !options.apiKey) {
      throw new Error("Either sessionToken or apiKey must be provided");
    }
    this.sessionToken = sessionToken;
    this.apiKey = options.apiKey;
  }
}
