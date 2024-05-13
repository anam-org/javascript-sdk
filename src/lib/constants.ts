import { version } from "./version";

export const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": `@anam-ai/sdk/${version}`,
};

export const DEFAULT_URL = "https://api.anam.ai";

export const PUBLIC_MESSAGE_ON_SIGNALLING_CLIENT_CONNECTION_FAILURE =
  "There was a problem connecting to our servers. Please try again.";

export const PUBLIC_MESSAGE_ON_WEBRTC_FAILURE =
  "There was an issue connecting to our servers. Please try again.";

// TODO: these should come from the server
export const DEFAULT_ICE_SERVERS = [
  {
    // urls: "stun:stun.l.google.com:19302",
    urls: "stun:stun.relay.metered.ca:80",
  },
  {
    urls: "turn:global.relay.metered.ca:80",
    username: "75533ce9605644d4873f8be0",
    credential: "spkGLyU5vosSyGKx",
  },
  {
    urls: "turn:global.relay.metered.ca:80?transport=tcp",
    username: "75533ce9605644d4873f8be0",
    credential: "spkGLyU5vosSyGKx",
  },
  {
    urls: "turn:global.relay.metered.ca:443",
    username: "75533ce9605644d4873f8be0",
    credential: "spkGLyU5vosSyGKx",
  },
  {
    urls: "turns:global.relay.metered.ca:443?transport=tcp",
    username: "75533ce9605644d4873f8be0",
    credential: "spkGLyU5vosSyGKx",
  },
];
