import { CLIENT_METADATA } from './constants';

export const DEFAULT_ANAM_METRICS_BASE_URL = 'https://api.anam.ai';
export const DEFAULT_ANAM_API_VERSION = '/v1';

export enum ClientMetricMeasurement {
  CLIENT_METRIC_MEASUREMENT_ERROR = 'client_error',
  CLIENT_METRIC_MEASUREMENT_CONNECTION_CLOSED = 'client_connection_closed',
  CLIENT_METRIC_MEASUREMENT_CONNECTION_ESTABLISHED = 'client_connection_established',
  CLIENT_METRIC_MEASUREMENT_SESSION_ATTEMPT = 'client_session_attempt',
  CLIENT_METRIC_MEASUREMENT_SESSION_SUCCESS = 'client_session_success',
}

let anamCurrentBaseUrl = DEFAULT_ANAM_METRICS_BASE_URL;
let anamCurrentApiVersion = DEFAULT_ANAM_API_VERSION;

export const setClientMetricsBaseUrl = (
  baseUrl: string,
  apiVersion: string = DEFAULT_ANAM_API_VERSION,
) => {
  anamCurrentBaseUrl = baseUrl;
  anamCurrentApiVersion = apiVersion;
};

export interface AnamMetricsContext {
  sessionId: string | null;
  organizationId: string | null;
  attemptCorrelationId: string | null;
}

let anamMetricsContext: AnamMetricsContext = {
  sessionId: null,
  organizationId: null,
  attemptCorrelationId: null,
};

export const setMetricsContext = (context: Partial<AnamMetricsContext>) => {
  anamMetricsContext = { ...anamMetricsContext, ...context };
};

export const sendClientMetric = async (
  name: string,
  value: string,
  tags?: Record<string, string | number>,
) => {
  try {
    const metricTags: Record<string, string | number> = {
      ...CLIENT_METADATA,
      ...tags,
    };

    // Add session and organization IDs if available
    if (anamMetricsContext.sessionId) {
      metricTags.sessionId = anamMetricsContext.sessionId;
    }
    if (anamMetricsContext.organizationId) {
      metricTags.organizationId = anamMetricsContext.organizationId;
    }
    if (anamMetricsContext.attemptCorrelationId) {
      metricTags.attemptCorrelationId = anamMetricsContext.attemptCorrelationId;
    }

    await fetch(
      `${anamCurrentBaseUrl}${anamCurrentApiVersion}/metrics/client`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          value,
          tags: metricTags,
        }),
      },
    );
  } catch (error) {
    console.error('Failed to send error metric:', error);
  }
};

export const createRTCStatsReport = (stats: RTCStatsReport) => {
  /**
   * constructs a report of the RTC stats for logging to the console
   */
  console.group('📊 WebRTC Session Statistics Report');

  // Collect stats by type for organized reporting
  const statsByType: Record<string, any[]> = {};

  stats.forEach((report) => {
    if (!statsByType[report.type]) {
      statsByType[report.type] = [];
    }
    statsByType[report.type].push(report);
  });

  // Report video statistics (AI video output)
  const inboundVideo =
    statsByType['inbound-rtp']?.filter((r) => r.kind === 'video') || [];
  if (inboundVideo.length > 0) {
    console.group('📹 Persona Video Stream (Inbound)');
    inboundVideo.forEach((report) => {
      console.log(`Frames Received: ${report.framesReceived || 'unknown'}`);
      console.log(`Frames Dropped: ${report.framesDropped || 'unknown'}`);
      console.log(`Frames Per Second: ${report.framesPerSecond || 'unknown'}`);
      console.log(
        `Packets Received: ${(report.packetsReceived || 'unknown').toLocaleString()}`,
      );
      console.log(`Packets Lost: ${report.packetsLost || 'unknown'}`);
      if (report.frameWidth && report.frameHeight) {
        console.log(`Resolution: ${report.frameWidth}x${report.frameHeight}`);
      }
      if (report.jitter !== undefined) {
        console.log(`Jitter: ${report.jitter.toFixed(5)}ms`);
      }
    });
    console.groupEnd();
  }

  // Report audio statistics (AI audio output)
  const inboundAudio =
    statsByType['inbound-rtp']?.filter((r) => r.kind === 'audio') || [];
  if (inboundAudio.length > 0) {
    console.group('🔊 Persona Audio Stream (Inbound)');
    inboundAudio.forEach((report) => {
      console.log(
        `Packets Received: ${(report.packetsReceived || 'unknown').toLocaleString()}`,
      );
      console.log(`Packets Lost: ${report.packetsLost || 'unknown'}`);
      console.log(`Audio Level: ${report.audioLevel || 'unknown'}`);
      if (report.jitter !== undefined) {
        console.log(`Jitter: ${report.jitter.toFixed(5)}ms`);
      }
      if (report.totalAudioEnergy !== undefined) {
        console.log(
          `Total Audio Energy: ${report.totalAudioEnergy.toFixed(6)}`,
        );
      }
    });
    console.groupEnd();
  }

  // Report user audio input statistics
  const outboundAudio =
    statsByType['outbound-rtp']?.filter((r) => r.kind === 'audio') || [];
  if (outboundAudio.length > 0) {
    console.group('🎤 User Audio Input (Outbound)');
    outboundAudio.forEach((report) => {
      console.log(
        `Packets Sent: ${(report.packetsSent || 'unknown').toLocaleString()}`,
      );
      if (report.retransmittedPacketsSent) {
        console.log(
          `Retransmitted Packets: ${report.retransmittedPacketsSent}`,
        );
      }
      if (report.totalPacketSendDelay !== undefined) {
        console.log(
          `Avg Packet Send Delay: ${((report.totalPacketSendDelay / (report.packetsSent || 1)) * 1000).toFixed(5)}ms`,
        );
      }
    });
    console.groupEnd();
  }

  // Report codec information
  if (statsByType['codec']) {
    console.group('🔧 Codecs Used');
    statsByType['codec'].forEach((report) => {
      const direction = report.payloadType ? 'Active' : 'Available';
      console.log(
        `${direction} ${report.mimeType || 'Unknown'} - Payload Type: ${report.payloadType || 'N/A'}`,
      );
      if (report.clockRate) {
        console.log(`  Clock Rate: ${report.clockRate}Hz`);
      }
      if (report.channels) {
        console.log(`  Channels: ${report.channels}`);
      }
    });
    console.groupEnd();
  }

  // Report any transport issues
  if (statsByType['transport']) {
    console.group('🚚 Transport Layer');
    statsByType['transport'].forEach((report) => {
      console.log(`DTLS State: ${report.dtlsState || 'unknown'}`);
      console.log(`ICE State: ${report.iceState || 'unknown'}`);
      if (report.bytesReceived || report.bytesSent) {
        console.log(
          `Data Transfer (bytes) - Sent: ${(report.bytesSent || 0).toLocaleString()}, Received: ${(report.bytesReceived || 0).toLocaleString()}`,
        );
      }
    });
    console.groupEnd();
  }

  // Summary of potential issues
  const issues: string[] = [];

  // Check for video issues
  inboundVideo.forEach((report) => {
    if (report.framesDropped > 0) {
      issues.push(`Video: ${report.framesDropped} frames dropped`);
    }
    if (report.packetsLost > 0) {
      issues.push(`Video: ${report.packetsLost} packets lost`);
    }
    if (report.framesPerSecond < 15) {
      issues.push(`Video: Low frame rate (${report.framesPerSecond} fps)`);
    }
  });

  // Check for audio issues
  inboundAudio.forEach((report) => {
    if (report.packetsLost > 0) {
      issues.push(`Audio: ${report.packetsLost} packets lost`);
    }
    if (report.jitter > 0.1) {
      issues.push(
        `Audio: High jitter (${(report.jitter * 1000).toFixed(1)}ms)`,
      );
    }
  });

  if (issues.length > 0) {
    console.group('⚠️ Potential Issues Detected');
    issues.forEach((issue) => console.warn(issue));
    console.groupEnd();
  } else {
    console.log('✅ No significant issues detected');
  }

  console.groupEnd();
};
