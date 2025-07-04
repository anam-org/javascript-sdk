import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:anam_sdk/anam_sdk.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Anam SDK Example',
      theme: ThemeData(
        primarySwatch: Colors.blue,
        useMaterial3: true,
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _apiKeyController = TextEditingController();
  AnamClient? _anamClient;
  final RTCVideoRenderer _remoteRenderer = RTCVideoRenderer();
  String _status = 'Not connected';
  bool _isConnecting = false;
  bool _isConnected = false;

  @override
  void initState() {
    super.initState();
    _initializeRenderer();
  }

  Future<void> _initializeRenderer() async {
    await _remoteRenderer.initialize();
  }

  Future<void> _startChat() async {
    final apiKey = _apiKeyController.text.trim();
    if (apiKey.isEmpty) {
      _showSnackBar('Please enter your API key');
      return;
    }

    setState(() {
      _isConnecting = true;
      _status = 'Requesting permissions...';
    });

    // Request microphone permission
    final micPermission = await Permission.microphone.request();
    if (!micPermission.isGranted) {
      setState(() {
        _isConnecting = false;
        _status = 'Microphone permission denied';
      });
      return;
    }

    setState(() {
      _status = 'Creating session...';
    });

    try {
      // Create persona config
      final personaConfig = PersonaConfig(
        name: 'Cara',
        avatarId: '30fa96d0-26c4-4e55-94a0-517025942e18',
        voiceId: '6bfbe25a-979d-40f3-a92b-5394170af54b',
        brainType: 'ANAM_GPT_4O_MINI_V1',
        systemPrompt: 'You are Cara, a helpful and friendly AI assistant. Keep responses conversational and concise.',
      );

      // Create client with API key (for demo only)
      _anamClient = AnamClient.createClientWithApiKey(
        apiKey,
        personaConfig,
      );

      // Listen for events
      _anamClient!.on<ConnectionClosedEventData>(AnamEvent.connectionClosed).listen((data) {
        setState(() {
          _status = 'Connection closed: ${data.reason ?? data.code.name}';
          _isConnected = false;
        });
      });

      _anamClient!.on<void>(AnamEvent.connectionEstablished).listen((_) {
        setState(() {
          _status = 'Connected! Start speaking to Cara';
          _isConnected = true;
        });
      });

      setState(() {
        _status = 'Connecting...';
      });

      // Start streaming
      await _anamClient!.streamToWidget(
        onVideoStream: (stream) {
          print('DEBUG: Received video stream with ${stream.getVideoTracks().length} video tracks');
          for (final track in stream.getVideoTracks()) {
            print('DEBUG: Video track - id: ${track.id}, enabled: ${track.enabled}, muted: ${track.muted}');
          }
          setState(() {
            _remoteRenderer.srcObject = stream;
          });
        },
      );
    } catch (e) {
      setState(() {
        _status = 'Error: ${e.toString()}';
        _isConnecting = false;
      });
    } finally {
      setState(() {
        _isConnecting = false;
      });
    }
  }

  Future<void> _stopChat() async {
    await _anamClient?.stopStreaming();
    setState(() {
      _remoteRenderer.srcObject = null;
      _isConnected = false;
      _status = 'Disconnected';
    });
  }

  void _showSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  void dispose() {
    _anamClient?.dispose();
    _remoteRenderer.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Anam SDK Flutter Example'),
        centerTitle: true,
      ),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            if (!_isConnected) ...[
              TextField(
                controller: _apiKeyController,
                decoration: const InputDecoration(
                  labelText: 'API Key',
                  hintText: 'Enter your Anam API key',
                  border: OutlineInputBorder(),
                ),
                obscureText: true,
              ),
              const SizedBox(height: 20),
            ],
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.black,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: _remoteRenderer.srcObject != null
                      ? RTCVideoView(
                          _remoteRenderer,
                          objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
                          mirror: false,
                        )
                      : const Center(
                          child: Text(
                            'Video will appear here',
                            style: TextStyle(color: Colors.white),
                          ),
                        ),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              _status,
              style: TextStyle(
                fontSize: 14,
                color: _isConnected ? Colors.green : Colors.grey[600],
              ),
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (!_isConnected) ...[
                  ElevatedButton(
                    onPressed: _isConnecting ? null : _startChat,
                    child: _isConnecting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Start Chat'),
                  ),
                ] else ...[
                  ElevatedButton(
                    onPressed: () async {
                      // Debug: Check video track status
                      final stream = _remoteRenderer.srcObject;
                      if (stream != null) {
                        print('Stream ID: ${stream.id}');
                        for (final track in stream.getVideoTracks()) {
                          print('Video track - id: ${track.id}, enabled: ${track.enabled}, muted: ${track.muted}');
                        }
                      }
                    },
                    child: const Text('Check Video Status'),
                  ),
                  const SizedBox(width: 10),
                  ElevatedButton(
                    onPressed: _stopChat,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red,
                    ),
                    child: const Text('End Chat'),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}