# Anam AI JavaScript SDK

This is the official JavaScript SDK for integrating Anam AI realtime digital personas into your product. It provides a simple and intuitive API to interact with Anam AI's services.

## Introduction

The Anam AI JavaScript SDK is designed to help developers integrate Anam AI's digital personas into their JavaScript applications. The SDK provides a set of APIs and utilities to make it easier to create, manage, and interact with digital personas in a realtime environment.

## Prerequisites

### An Anam AI account

Public account creation is currently unavailable. If you are a design partner your account will be created for you by our team.

### An Anam API key

Public API keys are not yet available. If you are a design partner an API key will be shared with you during onboarding.

## Getting Started

First, install the SDK in your project

```zsh
npm install @anam-ai/js-sdk
```

### Local development

The quickest way to start testing the SDK is to use your API key directly with our SDK and choose a default persona from our predefined examples.
To use the SDK you first need to create an instance of `AnamClient`. For local development you can do this using the `unsafe_createClientWithApiKey` method.

```typescript
import { unsafe_createClientWithApiKey } from '@anam-ai/js-sdk';

const anamClient = unsafe_createClientWithApiKey('your-api-key', {
  personaId: 'chosen-persona-id',
});
```

**NOTE**: the method `unsafe_createClientWithApiKey` is unsafe for production use cases because it requires exposing your api key to the client. When deploying to production see [production usage]() first.

Once you have an instance of the Anam client initialised you can start a session by streaming to audio and video elements in the DOM.

```typescript
await anamClient.streamToVideoAndAudioElements(
  'video-element-id',
  'audio-element-id',
);
```

This will start a new session using the pre-configured persona id and start streaming video and audio to the elements in the DOM with the matching element ids.
