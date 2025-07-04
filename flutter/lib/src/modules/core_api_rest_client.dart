import 'dart:convert';
import 'package:http/http.dart' as http;
import '../types/session_response.dart';
import '../types/persona_config.dart';
import '../utils/client_error.dart';
import '../utils/constants.dart';

class CoreApiRestClient {
  String? sessionToken;
  final String? apiKey;
  final String baseUrl;
  final String apiVersion;

  CoreApiRestClient({
    this.sessionToken,
    this.apiKey,
    String? baseUrl,
    String? apiVersion,
  })  : baseUrl = baseUrl ?? defaultAnamApiUrl,
        apiVersion = apiVersion ?? defaultAnamApiVersion;

  Future<StartSessionResponse> startSession({
    PersonaConfig? personaConfig,
  }) async {
    // If using API key, first get a session token
    if (sessionToken == null) {
      if (apiKey == null) {
        throw const ClientError(
          'Either sessionToken or apiKey must be provided',
          ErrorCode.configurationError,
        );
      }
      if (personaConfig == null) {
        throw const ClientError(
          'PersonaConfig is required when using API key',
          ErrorCode.configurationError,
        );
      }
      // Get session token first
      final tokenData = await _getSessionToken(personaConfig: personaConfig);
      sessionToken = tokenData['sessionToken'] as String;
    }

    final uri = Uri.parse('$baseUrl/$apiVersion/engine/session');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $sessionToken',
    };

    final requestBody = {
      'clientMetadata': clientMetadata,
    };
    
    if (personaConfig != null) {
      requestBody['personaConfig'] = personaConfig.toJson();
    }

    try {
      final response = await http.post(
        uri,
        headers: headers,
        body: jsonEncode(requestBody),
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        return StartSessionResponse.fromJson(data);
      } else if (response.statusCode == 401) {
        throw ClientError(
          'Authentication failed',
          ErrorCode.authenticationError,
          response.statusCode,
        );
      } else if (response.statusCode == 403) {
        throw ClientError(
          'Authentication failed when starting session',
          ErrorCode.authenticationError,
          response.statusCode,
        );
      } else {
        throw ClientError(
          'Failed to start session: ${response.body}',
          ErrorCode.serverError,
          response.statusCode,
        );
      }
    } catch (e) {
      if (e is ClientError) rethrow;
      throw ClientError(
        'Network error: ${e.toString()}',
        ErrorCode.networkError,
      );
    }
  }

  Future<Map<String, dynamic>> _getSessionToken({
    required PersonaConfig personaConfig,
  }) async {
    if (apiKey == null) {
      throw const ClientError(
        'API key is required to create session token',
        ErrorCode.configurationError,
      );
    }

    print('WARNING: Using unsecure method. This method should not be used in production.');

    final uri = Uri.parse('$baseUrl/$apiVersion/auth/session-token');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $apiKey',
    };

    final requestBody = {
      'clientLabel': 'flutter-sdk-api-key',
      'personaConfig': personaConfig.toJson(),
    };

    try {
      final response = await http.post(
        uri,
        headers: headers,
        body: jsonEncode(requestBody),
      );

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      } else if (response.statusCode == 401) {
        throw ClientError(
          'Invalid API key',
          ErrorCode.authenticationError,
          response.statusCode,
        );
      } else {
        throw ClientError(
          'Failed to create session token: ${response.body}',
          ErrorCode.serverError,
          response.statusCode,
        );
      }
    } catch (e) {
      if (e is ClientError) rethrow;
      throw ClientError(
        'Network error: ${e.toString()}',
        ErrorCode.networkError,
      );
    }
  }
}