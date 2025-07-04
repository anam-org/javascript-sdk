const String defaultAnamApiUrl = 'https://api.anam.ai';
const String defaultAnamApiVersion = 'v1';
const String defaultAnamMetricsBaseUrl = 'https://metrics.anam.ai';

const int defaultHeartbeatIntervalSeconds = 5;
const int defaultWsReconnectionAttempts = 5;
const int successMetricPollingTimeoutMs = 15000;

const String sdkVersion = '0.1.0';
const String sdkPlatform = 'flutter';

const Map<String, dynamic> clientMetadata = {
  'client': 'flutter-sdk',
  'version': sdkVersion,
};