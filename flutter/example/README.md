# Anam SDK Example

A Flutter example app demonstrating the Anam SDK for creating interactive AI personas with real-time audio/video streaming.

## Getting Started

1. **Get an API Key**: Sign up at [Anam AI](https://anam.ai) to get your API key.

2. **Install Dependencies**:

   ```bash
   flutter pub get
   ```

3. **Run the App**:
   ```bash
   flutter run
   ```

## Features

- Real-time video streaming of AI persona (Cara)
- Voice interaction with microphone input
- Connection status display
- Simple UI demonstrating SDK usage

## Usage

1. Enter your Anam API key in the text field
2. Tap "Start Chat" to begin
3. Grant microphone permission when prompted
4. Start speaking to interact with Cara
5. Tap "End Chat" to disconnect

## Platform Notes

- **iOS**: Microphone and camera permissions are configured in Info.plist
- **Android**: Required permissions are configured in AndroidManifest.xml
- **Web**: Ensure you're serving over HTTPS for microphone access

## Code Structure

The main implementation is in `lib/main.dart`, demonstrating:

- SDK initialization with API key
- WebRTC stream handling
- Event listening
- UI state management
