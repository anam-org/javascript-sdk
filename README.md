# Anam AI JavaScript SDK

This is the official JavaScript SDK for integrating Anam AI realtime digital personas into your product. It provides a simple and intuitive API to interact with Anam AI's services.

## Introduction

The Anam AI JavaScript SDK is designed to help developers integrate Anam AI's digital personas into their JavaScript applications. The SDK provides a set of APIs and utilities to make it easier to create, manage, and interact with digital personas in a realtime environment.

## Documentation

Full documentation is available at [docs.anam.ai](https://docs.anam.ai).

## Examples

Check out our [example projects](https://github.com/anam-org/anam-examples) for implementation samples.

## Prerequisites

### An Anam AI account

To create a free account head to the [Anam Lab](https://lab.anam.ai) and sign up.

### An Anam API key

To use the SDK you first need an API key. Follow the instructions [here](https://docs.anam.ai/guides/get-started/api-key) to create one.

# Getting Started

First, install the SDK in your project

```zsh
npm install @anam-ai/js-sdk
```

## Deprecation Notice

**Important**: The `brainType` field in `PersonaConfig` is deprecated and will be removed in a future version. Please use `llmId` instead. If you are currently using `brainType`, you will see a deprecation warning in the console. Both fields are supported during the transition period.

## Local development

The quickest way to start testing the SDK is to use your API key directly with our SDK and the example persona config shown below.
To use the SDK you first need to create an instance of `AnamClient`. For local development you can do this using the `unsafe_createClientWithApiKey` method.

```typescript
import { unsafe_createClientWithApiKey } from '@anam-ai/js-sdk';

const anamClient = unsafe_createClientWithApiKey('your-api-key', {
  personaId: '<PERSONA ID HERE>',
  name: 'Cara',
  avatarId: '30fa96d0-26c4-4e55-94a0-517025942e18',
  voiceId: '6bfbe25a-979d-40f3-a92b-5394170af54b',
  brainType: 'ANAM_GPT_4O_MINI_V1',
  systemPrompt:
    "[STYLE] Reply in natural speech without formatting. Add pauses using '...' and very occasionally a disfluency. [PERSONALITY] You are Cara, a helpful assistant.",
});
```

**NOTE**: the method `unsafe_createClientWithApiKey` is unsafe for production use cases because it requires exposing your api key to the client. When deploying to production see [production usage](#usage-in-production) first.

Once you have an instance of the Anam client initialised you can start a session by streaming to audio and video elements in the DOM.

```typescript
await anamClient.streamToVideoElement('video-element-id');
```

This will start a new session using the pre-configured persona id and start streaming video element in the DOM with the matching element id.

To stop a session use the `stopStreaming` method.

```typescript
anamClient.stopStreaming();
```

## Usage in production

When deploying to production it is important not to publicly expose your API key. To avoid this issue you should first exchange your API key for a short-lived session token on the server side. Session tokens can then be passed to the client and used to initialise the Anam SDK.

**From the server**

```typescript
const response = await fetch(`https://api.anam.ai/v1/auth/session-token`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    personaConfig: {
      name: 'Cara',
      avatarId: '30fa96d0-26c4-4e55-94a0-517025942e18',
      voiceId: '6bfbe25a-979d-40f3-a92b-5394170af54b',
      llmId: '<LLM ID HERE>',
      systemPrompt:
        "[STYLE] Reply in natural speech without formatting. Add pauses using '...' and very occasionally a disfluency. [PERSONALITY] You are Cara, a helpful assistant.",
    },
  }),
});
const data = await response.json();
const sessionToken = data.sessionToken;
```

Once you have a session token you can use the `createClient` method of the Anam SDK to initialise an Anam client instance.

```typescript
import { createClient } from '@anam-ai/js-sdk';

const anamClient = createClient('your-session-token');
```

To show the AI avatar disclosure throughout the session:

```typescript
const anamClient = createClient('your-session-token', {
  showAiAvatarDisclosure: true,
});
```

Regardless of whether you initialise the client using an API key or session token the client exposes the same set of available methods for streaming.

[See here](#starting-a-session-in-production-environments) for an example sequence diagram of starting a session in production environments.

## Director Notes (Cara 4)

On Cara 4 avatars you can add **Director Notes** to guide the avatar's performance. Provide either a built-in `presetStyle` **or** a free-form `customStylePrompt` — the two are mutually exclusive (enforced by the `DirectorNotes` type) — plus an optional `expressivity` value, normalized from `0` to `1`, controlling how expressively the style is played (lower values are steadier; higher values increase style and speech-driven motion together; omit it to use the engine default). Director Notes are forwarded unchanged to session-token creation and are only applied on Cara 4 avatars; on older models the server ignores them and the session proceeds without them.

```typescript
import { unsafe_createClientWithApiKey } from '@anam-ai/js-sdk';

const anamClient = unsafe_createClientWithApiKey('your-api-key', {
  personaId: '<PERSONA ID HERE>',
  name: 'Cara',
  // Use a Cara 4 avatar — Director Notes are ignored on older models.
  avatarId: '30fa96d0-26c4-4e55-94a0-517025942e18',
  voiceId: '6bfbe25a-979d-40f3-a92b-5394170af54b',
  llmId: '<LLM ID HERE>',
  systemPrompt:
    '[STYLE] Reply in natural speech without formatting. [PERSONALITY] You are Cara, a helpful assistant.',
  directorNotes: {
    presetStyle: 'warm',
    expressivity: 0.5,
  },
});
```

To use a free-form style instead of a preset, provide `customStylePrompt`:

```typescript
directorNotes: {
  customStylePrompt:
    'Warm smile, composed, slightly amused, looking directly at camera',
  expressivity: 0.5,
}
```

You can also set `expressivity` on its own to tune how expressively the avatar's default style is played:

```typescript
directorNotes: {
  expressivity: 0.2,
}
```

### Sending Director Note cues mid-session

On Cara 4 you can use `sendDirectorNoteCue` to change the performance as a conversation unfolds. Cues use the engine's dedicated cue path, so they do not purge buffered audio or video. Data-channel cues are primarily for audio-passthrough sessions; for Turnkey sessions, prefer inline cue tags in persona speech text.

```typescript
import { AnamEvent, type DirectorNoteCueTag } from '@anam-ai/js-sdk';

let cueChannelOpen = false;
anamClient.addListener(AnamEvent.DATA_CHANNEL_OPEN, () => {
  cueChannelOpen = true;
});
anamClient.addListener(AnamEvent.CONNECTION_CLOSED, () => {
  cueChannelOpen = false;
});

// Call this later from your TTS timing callback for an active persona turn.
function onTtsCue(tag: DirectorNoteCueTag, atSeconds: number) {
  if (!cueChannelOpen) {
    throw new Error('Director Note cue channel is not open');
  }

  anamClient.sendDirectorNoteCue(tag, { atSeconds });
}

// Wire onTtsCue to your TTS provider's cue/word-timing callback. For example,
// report `warm` at 0 seconds and `surprised` at 1.25 seconds for that turn.
```

Register the listener before starting the stream so it cannot miss the event. Sending before `DATA_CHANNEL_OPEN` throws instead of silently dropping the cue. Omitting timing applies the cue immediately. `inSeconds` is a delay from now during an active response, while `atSeconds` is an absolute offset from the start of persona speech and is preferred when aligning cues to generated audio; provide at most one. Runtime cue tags also include cue-only styles such as `laughter`, `curious`, `concerned`, and `surprised` that are not available as session-start `presetStyle` values.
