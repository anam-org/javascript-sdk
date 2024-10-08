# Anam AI JavaScript SDK

This is the official JavaScript SDK for integrating Anam AI realtime digital personas into your product. It provides a simple and intuitive API to interact with Anam AI's services.

## Introduction

The Anam AI JavaScript SDK is designed to help developers integrate Anam AI's digital personas into their JavaScript applications. The SDK provides a set of APIs and utilities to make it easier to create, manage, and interact with digital personas in a realtime environment.

## Prerequisites

### An Anam AI account

Public account creation is currently unavailable. If you are a design partner your account will be created for you by our team.

### An Anam API key

Public API keys are not yet available. If you are a design partner an API key will be shared with you during onboarding.

# Getting Started

First, install the SDK in your project

```zsh
npm install @anam-ai/js-sdk
```

## Local development

The quickest way to start testing the SDK is to use your API key directly with our SDK and [choose a default persona](#listing-personas) from our predefined examples.
To use the SDK you first need to create an instance of `AnamClient`. For local development you can do this using the `unsafe_createClientWithApiKey` method.

```typescript
import { unsafe_createClientWithApiKey } from '@anam-ai/js-sdk';

const anamClient = unsafe_createClientWithApiKey('your-api-key', {
  personaId: 'chosen-persona-id',
});
```

**NOTE**: the method `unsafe_createClientWithApiKey` is unsafe for production use cases because it requires exposing your api key to the client. When deploying to production see [production usage](#usage-in-production) first.

Once you have an instance of the Anam client initialised you can start a session by streaming to audio and video elements in the DOM.

```typescript
await anamClient.streamToVideoAndAudioElements(
  'video-element-id',
  'audio-element-id',
);
```

This will start a new session using the pre-configured persona id and start streaming video and audio to the elements in the DOM with the matching element ids.

To stop a session use the `stopStopStreaming` method.

```typescript
anamClient.stopStreaming();
```

## Usage in production

When deploying to production it is important not to publicly expose your API key. To avoid this issue you should first exchange your API key for a short-lived session token on the server side. Session tokens can then be passed to the client and used to initialise the Anam SDK.

**From the server**

```typescript
const response = await fetch(`https://api.anam.ai/v1/auth/session-token`, {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
});
const data = await response.json();
const sessionToken = data.sessionToken;
```

Once you have a session token you can use the `createClient` method of the Anam SDK to initialise an Anam client instance.

```typescript
import { createClient } from '@anam-ai/js-sdk';

const anamClient = createClient('your-session-token', {
  personaId: 'chosen-persona-id',
});
```

Regardless of whether you initialise the client using an API key or session token the client exposes the same set of available methods for streaming.

[See here](#starting-a-session-in-production-environments) for an example sequence diagram of starting a session in production environments.

## Using the Talk command to control persona output

Sometimes during a persona session you may wish to force a response from the persona. For example when the user interacts with an element on the page or when you have disabled the Anam LLM in order to use your own. To do this you can use the `talk` method of the Anam client.

```typescript
anamClient.talk('Content to say');
```

The `talk` method will send a `talk` command to the persona which will respond by speaking the provided content.

## Streaming Talk input

You may want to stream a particular message to the persona in multiple chunks. For example when you are streaming output from a custom LLM and want to reduce latency by sending the message in chunks. To do this you can use the `createTalkMessageStream` method to create a `TalkMessageStream` instance and use the `streamMessageChunk` method to send the message in chunks.

This approach can be useful to reduce latency when streaming output from a custom LLM, however it does introduce some complexity due to the need to handle interrupts and end of speech.

Example usage:

```typescript
const talkMessageStream = anamClient.createTalkMessageStream();
const chunks = ['He', 'l', 'lo', ', how are you?'];

for (const chunk of chunks) {
  if (talkMessageStream.isActive()) {
    talkMessageStream.streamMessageChunk(
      chunk,
      chunk === chunks[chunks.length - 1],
    );
  }
}
```

If a sentence is not interrupted, you must signal the end of the speech yourself by calling `streamMessageChunk` with the `endOfSpeech` parameter set to `true` or by calling `talkMessageStream.endMessage()`. If a talkMessageStream is already closed, either due to an interrupt or end of speech, you do not need to signal end of speech.

**Important note**: One talkMessageStream represents one "turn" in the conversation. Once that turn is over, the object can no longer be used and you must create a new `TalkMessageStream` using `anamClient.createTalkMessageStream()`.

There are two ways a "turn" can end and a `TalkMessageStream` closed:

1. End of speech: `streamMessageChunk` is called with the `endOfSpeech` parameter set to `true` or `endMessage` is called.
2. Interrupted by user speech: The user speaks during the stream causing an `AnamEvent.TALK_STREAM_INTERRUPTED` event to fire and the `TalkMessageStream` object to be closed automatically.

In both of these cases the `TalkMessageStream` object is closed and no longer usable. If you try to call `streamMessageChunk` or `endMessage` on a closed `TalkMessageStream` object you will be met with an error. To handle this you can check the `isActive()` method of the `TalkMessageStream` object or listen for the `AnamEvent.TALK_STREAM_INTERRUPTED` event.

#### Correlation IDs

The `streamMessageChunk` method accepts an optional `correlationId` parameter. **This should be unique for every `TalkMessageStream` instance.** When a talk stream is interrupted by user speech the interrupted stream's `correlationId` will be sent in the `AnamEvent.TALK_STREAM_INTERRUPTED` event.

Currently only one `TalkMessageStream` can be active at a time, so this is not strictly necessary.

## Controlling the input audio

### Audio input state

By default the Anam client starts capturing input audio from the users microphone when a session starts and stops capturing the audio when the session ends. For certain use cases however, you may wish to control the input audio state programmatically.

To get the current input audio state.

```typescript
const audioState: InputAudioState = anamClient.getInputAudioState();
// { isMuted: false } or { isMuted: true }
```

To mute the input audio.

```typescript
const audioState: InputAudioState = anamClient.muteInputAudio();
// { isMuted: true }
```

**Note**: If you mute the input audio before starting a stream the session will start with microphone input disabled.

To unmute the input audio.

```typescript
const audioState: InputAudioState = anamClient.unmuteInputAudio();
// { isMuted: false }
```

### Using custom input streams

If you wish to control the microphone input audio capture yourself you can instead pass your own `MediaStream` object when starting a stream.

```typescript
anamClient.streamToVideoAndAudioElements(
  'video-element-id',
  'audio-element-id',
  userProvidedMediaStream,
);
```

The `userProvidedMediaStream` object must be an instance of `MediaStream` and the user input audio should be the first audio track returned from the `MediaStream.getAudioTracks()` method.

**Note**: This is the default behaviour if you are using `navigator.mediaDevices.getUserMedia()`.

## Additional Configuration

### Disable brains

You can turn off the Anam LLM by passing the `disableBrains` config option to the client during initialisation. If this option is set to `true` then the persona will wait to receive `talk` commands and will not respond to voice input from the user.

```typescript
import { createClient } from '@anam-ai/js-sdk';

const anamClient = createClient('your-session-token', {
  personaId: 'chosen-persona-id',
  disableBrains: true,
});
```

### Disable filler phrases

To turn off the use of filler phrases by the persona you can set the `disableFillerPhrases` option to true.

```typescript
import { createClient } from '@anam-ai/js-sdk';

const anamClient = createClient('your-session-token', {
  personaId: 'chosen-persona-id',
  disableFillerPhrases: true,
});
```

> **Note**: the option `disableFillerPhrases` has no effect if `disableBrains` is set to `true`.

### Updating client config after initialisation

If you have already initialised the Anam client but wish to update the persona configuration you can use the `setPersonaConfig` method

```typescript
import { createClient } from '@anam-ai/js-sdk';

const anamClient = createClient('your-session-token', {
  personaId: 'chosen-persona-id',
});

anamClient.setPersonaConfig({
  personaId: 'chosen-persona-id',
  disableFillerPhrases: true,
});
```

To check the currently set config use the `getPersonaConfig` method.

```typescript
const config = anamClient.getPersonaConfig();
```

## Session Options

Session options are a set of optional parameters that can be adjusted to tweak the behaviour of a session, such as controlling the sensitivity of the Anam voice detection. Session options can be passed to the Anam client during initialisation.

```typescript
const anamClient = createClient(
  'your-session-token',
  {
    personaId: 'chosen-persona-id',
  },
  {
    voiceDetection: { endOfSpeechSensitivity: 0.7 },
  },
);
```

### Available Session Options

| Option           | Sub-option               | Type   | Description                                             | Status      |
| ---------------- | ------------------------ | ------ | ------------------------------------------------------- | ----------- |
| `voiceDetection` | `endOfSpeechSensitivity` | number | Adjusts the sensitivity of the end-of-speech detection. | Coming soon |

## Listening to Events

After initialising the Anam client you can register any event listeners using the `addListener` method.

```typescript
anamClient.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
  console.log('Connection Established');
});

anamClient.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
  console.log('Updated Messages: ', messages);
});
```

### Event Types

| Event Name                      | Description                                                                                                                                                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONNECTION_ESTABLISHED`        | Called when the direct connection between the browser and the Anam Engine has been established.                                                                                                                                                                                  |
| `CONNECTION_CLOSED`             | Called when the direct connection between the browser and the Anam Engine has been closed.                                                                                                                                                                                       |
| `VIDEO_PLAY_STARTED`            | When streaming directly to a video element this event is fired when the first frames start playing. Useful for removing any loading indicators during connection.                                                                                                                |
| `MESSAGE_HISTORY_UPDATED`       | Called with the message history transcription of the current session each time the user or the persona finishes speaking.                                                                                                                                                        |
| `MESSAGE_STREAM_EVENT_RECEIVED` | For persona speech, this stream is updated with each transcribed speech chunk as the persona is speaking. For the user speech this stream is updated with a complete transcription of the user's sentence once they finish speaking                                              |
| `INPUT_AUDIO_STREAM_STARTED`    | Called with the users input audio stream when microphone input has been initialised.                                                                                                                                                                                             |
| `TALK_STREAM_INTERRUPTED`       | Called when the user interrupts the current `TalkMessageStream` by speaking. The interrupted stream's `correlationId` will be sent in the event. The TalkMessageStream object is automatically closed by the SDK but this event is provided to allow for any additional actions. |

# Personas

Available personas are managed via the [Anam API](https://api.anam.ai/api).

> **Note**: The examples below are shown using bash curl syntax. For the best experience we recommend trying queries directly from our [interactive Swagger documentation](https://api.anam.ai/api). To use the interactive Swagger documentation you will first need to authenticate by clicking the Authorize button in the top right and pasting your API key into the displayed box.

### Listing Available Personas

To list all personas available for your account use the `/v1/personas` endpoint.

```bash
# Example Request
curl -X GET "https://api.anam.ai/v1/personas" -H "Authorization: Bearer your-api-key"

# Example Response

{
  "data": [
    {
      "id": "773a8ca8-efd8-4449-9305-8b8bc1591475",
      "name": "Leo",
      "description": "Leo is the virtual receptionist of the Sunset Hotel.",
      "personaPreset": "leo",
      "isDefaultPersona": true,
      "createdAt": "2021-01-01T00:00:00Z",
      "updatedAt": "2021-01-02T00:00:00Z"
    }
  ],
  "meta": {
    "total": 1,
    "lastPage": 0,
    "currentPage": 1,
    "perPage": 10,
    "prev": 0,
    "next": 0
  }
}

```

Every Anam account has access to a pre-defined list of 'default personas', identifiable by the `isDefaultPersona` attribute. Currently there is one default persona 'Leo', the virtual receptionist of the Sunset Hotel.

> **Quick start**: Use the persona id `773a8ca8-efd8-4449-9305-8b8bc1591475` when initialising the SDK if you wish to try out Leo.

To show more detail about a specific persona you can use the `/v1/personas/{id}` endpoint.

```bash
# Example Request
curl -X GET "https://api.anam.ai/v1/personas/773a8ca8-efd8-4449-9305-8b8bc1591475" -H "Authorization: Bearer your-api-key"

# Example Response
{
  "id": "773a8ca8-efd8-4449-9305-8b8bc1591475",
  "name": "Leo",
  "description": "Leo is the virtual receptionist of the Sunset Hotel.",
  "personaPreset": "leo",
  "brain": {
    "id": "3c4525f0-698d-4e8d-b619-8c97a23780512",
    "personality": "You are role-playing as a text chatbot hotel receptionist at The Sunset Hotel. Your name is Leo.",
    "systemPrompt": "You are role-playing as a text chatbot hotel receptionist at The Sunset Hotel...",
    "fillerPhrases": ["One moment please.", "Let me check that for you."],
    "createdAt": "2021-01-01T00:00:00Z",
    "updatedAt": "2021-01-02T00:00:00Z"
  }
}
```

### Creating Custom Personas

You can create your own custom personas by using the `/v1/personas` endpoint via a `POST` request which defined the following properties:
| Persona parameter | Description |
|----------------|---------------------------------------------------------------------------------------------------------|
| `name` | The name for the persona. This is used as a human-readable identifier for the persona. |
| `description` | A brief description of the persona. This is optional and helps provide context about the persona's role. Not used by calls to the LLM|
| `personaPreset`| Defines the face and voice of the persona from a list of available presets. |
| `brain` | Configuration for the persona's LLM 'brain' including the system prompt, personality, and filler phrases.|

| Brain Parameter | Description                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `systemPrompt`  | The prompt used for initializing LLM interactions, setting the context for the persona's behaviour.   |
| `personality`   | A short description of the persona's character traits which influences the choice of filler phrases.  |
| `fillerPhrases` | Phrases used to enhance interaction response times, providing immediate feedback before a full reply. |

Example usage

```bash
# Example Request
curl -X POST "https://api.anam.ai/v1/personas" -H "Content-Type: application/json" -H "Authorization: Bearer your-api-key" -d '{
  "name": "Leo",
  "description": "Leo is the virtual receptionist of the Sunset Hotel.",
  "personaPreset": "leo",
  "brain": {
    "systemPrompt": "You are Leo, a virtual receptionist...",
    "personality": "You are role-playing as a text chatbot hotel receptionist at The Sunset Hotel. Your name is Leo.",
    "fillerPhrases": ["One moment please.", "Let me check that for you."]
  }
}'

# Example Response
{
  "id": "new_persona_id",
  "name": "Leo",
  "description": "Leo is the virtual receptionist of the Sunset Hotel.",
  "personaPreset": "leo",
  "brain": {
    "id": "new_brain_id",
    "personality": "helpful and friendly",
    "systemPrompt": "You are Leo, a virtual receptionist...",
    "fillerPhrases": ["One moment please...", "Let me check that for you..."],
    "createdAt": "2021-01-01T00:00:00Z",
    "updatedAt": "2021-01-02T00:00:00Z"
  }
}
```

# Sequence Diagrams

## Starting a session in production environments

![Example sequence diagram](media://start-session.png)

## Interaction loop

![Example interaction loop](media://interaction-loop.png)

## Interaction loop with custom LLM usage

![Example interaction loop for custom LLM diagram](media://custom-llm-interaction.png)
