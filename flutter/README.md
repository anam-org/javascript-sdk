# Anam SDK for Flutter

Flutter SDK for Anam AI - Create interactive AI personas with real-time audio/video streaming.

## Features

- Real-time WebRTC audio/video streaming
- Session token authentication
- Microphone input control
- Event-driven architecture
- Cross-platform support (iOS, Android, Web)

## Installation

Add this to your `pubspec.yaml`:

```yaml
dependencies:
  anam_sdk: ^0.1.0
```

## Platform Setup

### iOS

Add the following to your `Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app needs access to microphone for voice chat</string>
<key>NSCameraUsageDescription</key>
<string>This app needs access to camera for video chat</string>
```

### Android

Add the following permissions to your `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### Web

No additional setup required.

## Usage

### Basic Example

```dart
import 'package:anam_sdk/anam_sdk.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

// Create a client with session token (recommended)
final anamClient = AnamClient.createClient(sessionToken);

// Or create with API key (for testing only)
final anamClient = AnamClient.createClientWithApiKey(
  apiKey,
  PersonaConfig(
    name: 'Cara',
    avatarId: 'avatar-id',
    voiceId: 'voice-id',
    brainType: 'ANAM_GPT_4O_MINI_V1',
    systemPrompt: 'You are a helpful assistant.',
  ),
);

// Start streaming
await anamClient.streamToWidget(
  onVideoStream: (stream) {
    // Use stream with RTCVideoView
    videoRenderer.srcObject = stream;
  },
  onAudioStream: (stream) {
    // Audio is automatically played
  },
);

// Send a message
await anamClient.talk("Hello, how are you?");

// Stop streaming
await anamClient.stopStreaming();
```

### Listening to Events

```dart
// Connection events
anamClient.on<void>(AnamEvent.connectionEstablished).listen((_) {
  print('Connected!');
});

anamClient.on<ConnectionClosedEventData>(AnamEvent.connectionClosed).listen((data) {
  print('Connection closed: ${data.reason}');
});

// Agent talking events
anamClient.on<void>(AnamEvent.agentStartTalking).listen((_) {
  print('Agent started talking');
});

anamClient.on<void>(AnamEvent.agentStopTalking).listen((_) {
  print('Agent stopped talking');
});
```

### Mute/Unmute Microphone

```dart
// Mute microphone
anamClient.updateInputAudioState(InputAudioState(isMuted: true));

// Unmute microphone
anamClient.updateInputAudioState(InputAudioState(isMuted: false));
```

## Example App

See the `example` directory for a complete Flutter app demonstrating the SDK usage.

To run the example:

```bash
cd example
flutter run
```

## API Reference

### AnamClient

The main client class for interacting with Anam AI.

#### Static Methods

- `createClient(String sessionToken, [AnamClientOptions? options])` - Create client with session token
- `createClientWithApiKey(String apiKey, PersonaConfig config, [AnamClientOptions? options])` - Create client with API key (testing only)

#### Instance Methods

- `streamToWidget({required VideoStreamCallback onVideoStream, AudioStreamCallback? onAudioStream})` - Start streaming
- `talk(String content)` - Send a text message to the AI
- `stopStreaming()` - Stop the current streaming session
- `updateInputAudioState(InputAudioState state)` - Update microphone state
- `on<T>(AnamEvent event)` - Listen to SDK events
- `dispose()` - Clean up resources

### PersonaConfig

Configuration for the AI persona.

```dart
PersonaConfig(
  name: 'Cara',
  avatarId: 'avatar-id',
  voiceId: 'voice-id',
  brainType: 'ANAM_GPT_4O_MINI_V1',
  systemPrompt: 'You are a helpful assistant.',
  maxSessionLengthSeconds: 300,
  languageCode: 'en-US',
)
```

### Events

- `AnamEvent.connectionEstablished` - WebRTC connection established
- `AnamEvent.connectionClosed` - Connection closed
- `AnamEvent.sessionStarted` - Session started with API
- `AnamEvent.videoStreamStarted` - Video stream available
- `AnamEvent.audioStreamStarted` - Audio stream available
- `AnamEvent.videoPlayStarted` - First video frame rendered
- `AnamEvent.agentStartTalking` - AI started speaking
- `AnamEvent.agentStopTalking` - AI stopped speaking
- `AnamEvent.error` - Error occurred

## License

MIT
