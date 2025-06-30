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

export interface RTCStatsJsonReport {
  personaVideoStream?: {
    framesReceived: number | string;
    framesDropped: number | string;
    framesPerSecond: number | string;
    packetsReceived: number | string;
    packetsLost: number | string;
    resolution?: string;
    jitter?: number;
  }[];
  personaAudioStream?: {
    packetsReceived: number | string;
    packetsLost: number | string;
    audioLevel: number | string;
    jitter?: number;
    totalAudioEnergy?: number;
  }[];
  userAudioInput?: {
    packetsSent: number | string;
    retransmittedPackets?: number;
    avgPacketSendDelay?: number;
  }[];
  codecs?: {
    status: string;
    mimeType: string;
    payloadType: string | number;
    clockRate?: number;
    channels?: number;
  }[];
  transportLayer?: {
    dtlsState: string;
    iceState: string;
    bytesSent?: number;
    bytesReceived?: number;
  }[];
  issues: string[];
}

export const createRTCStatsReport = (
  stats: RTCStatsReport,
  outputFormat: 'console' | 'json' = 'console',
): RTCStatsJsonReport | void => {
  /**
   * constructs a report of the RTC stats for logging to the console or returns as JSON
   */

  // Collect stats by type for organized reporting
  const statsByType: Record<string, any[]> = {};

  stats.forEach((report) => {
    if (!statsByType[report.type]) {
      statsByType[report.type] = [];
    }
    statsByType[report.type].push(report);
  });

  // Initialize JSON report structure
  const jsonReport: RTCStatsJsonReport = {
    issues: [],
  };

  // Build video statistics (Persona video output)
  const inboundVideo =
    statsByType['inbound-rtp']?.filter((r) => r.kind === 'video') || [];
  if (inboundVideo.length > 0) {
    jsonReport.personaVideoStream = [];

    inboundVideo.forEach((report) => {
      const videoData = {
        framesReceived: report.framesReceived || 'unknown',
        framesDropped: report.framesDropped || 'unknown',
        framesPerSecond: report.framesPerSecond || 'unknown',
        packetsReceived: report.packetsReceived || 'unknown',
        packetsLost: report.packetsLost || 'unknown',
        resolution:
          report.frameWidth && report.frameHeight
            ? `${report.frameWidth}x${report.frameHeight}`
            : undefined,
        jitter: report.jitter !== undefined ? report.jitter : undefined,
      };

      jsonReport.personaVideoStream!.push(videoData);
    });
  }

  // Build audio statistics (Persona audio output)
  const inboundAudio =
    statsByType['inbound-rtp']?.filter((r) => r.kind === 'audio') || [];
  if (inboundAudio.length > 0) {
    jsonReport.personaAudioStream = [];

    inboundAudio.forEach((report) => {
      const audioData = {
        packetsReceived: report.packetsReceived || 'unknown',
        packetsLost: report.packetsLost || 'unknown',
        audioLevel: report.audioLevel || 'unknown',
        jitter: report.jitter !== undefined ? report.jitter : undefined,
        totalAudioEnergy:
          report.totalAudioEnergy !== undefined
            ? report.totalAudioEnergy
            : undefined,
      };

      jsonReport.personaAudioStream!.push(audioData);
    });
  }

  // Build user audio input statistics
  const outboundAudio =
    statsByType['outbound-rtp']?.filter((r) => r.kind === 'audio') || [];
  if (outboundAudio.length > 0) {
    jsonReport.userAudioInput = [];

    outboundAudio.forEach((report) => {
      const userAudioData = {
        packetsSent: report.packetsSent || 'unknown',
        retransmittedPackets: report.retransmittedPacketsSent || undefined,
        avgPacketSendDelay:
          report.totalPacketSendDelay !== undefined
            ? (report.totalPacketSendDelay / (report.packetsSent || 1)) * 1000
            : undefined,
      };

      jsonReport.userAudioInput!.push(userAudioData);
    });
  }

  // Build codec information
  if (statsByType['codec']) {
    jsonReport.codecs = [];

    statsByType['codec'].forEach((report) => {
      const codecData = {
        status: report.payloadType ? 'Active' : 'Available',
        mimeType: report.mimeType || 'Unknown',
        payloadType: report.payloadType || 'N/A',
        clockRate: report.clockRate || undefined,
        channels: report.channels || undefined,
      };

      jsonReport.codecs!.push(codecData);
    });
  }

  // Build transport layer information
  if (statsByType['transport']) {
    jsonReport.transportLayer = [];

    statsByType['transport'].forEach((report) => {
      const transportData = {
        dtlsState: report.dtlsState || 'unknown',
        iceState: report.iceState || 'unknown',
        bytesSent: report.bytesSent || undefined,
        bytesReceived: report.bytesReceived || undefined,
      };

      jsonReport.transportLayer!.push(transportData);
    });
  }

  // Build issues summary
  const issues: string[] = [];

  // Check for video issues
  inboundVideo.forEach((report) => {
    if (typeof report.framesDropped === 'number' && report.framesDropped > 0) {
      issues.push(`Video: ${report.framesDropped} frames dropped`);
    }
    if (typeof report.packetsLost === 'number' && report.packetsLost > 0) {
      issues.push(`Video: ${report.packetsLost} packets lost`);
    }
    if (
      typeof report.framesPerSecond === 'number' &&
      report.framesPerSecond < 23
    ) {
      issues.push(`Video: Low frame rate (${report.framesPerSecond} fps)`);
    }
  });

  // Check for audio issues
  inboundAudio.forEach((report) => {
    if (typeof report.packetsLost === 'number' && report.packetsLost > 0) {
      issues.push(`Audio: ${report.packetsLost} packets lost`);
    }
    if (typeof report.jitter === 'number' && report.jitter > 0.1) {
      issues.push(
        `Audio: High jitter (${(report.jitter * 1000).toFixed(1)}ms)`,
      );
    }
  });

  jsonReport.issues = issues;

  // Return JSON if requested
  if (outputFormat === 'json') {
    return jsonReport;
  }

  // Generate console output from JSON report
  console.group('📊 WebRTC Session Statistics Report');

  // Console output for video stream
  if (
    jsonReport.personaVideoStream &&
    jsonReport.personaVideoStream.length > 0
  ) {
    console.group('📹 Persona Video Stream (Inbound)');
    jsonReport.personaVideoStream.forEach((videoData) => {
      console.log(`Frames Received: ${videoData.framesReceived}`);
      console.log(`Frames Dropped: ${videoData.framesDropped}`);
      console.log(`Frames Per Second: ${videoData.framesPerSecond}`);
      console.log(
        `Packets Received: ${typeof videoData.packetsReceived === 'number' ? videoData.packetsReceived.toLocaleString() : videoData.packetsReceived}`,
      );
      console.log(`Packets Lost: ${videoData.packetsLost}`);
      if (videoData.resolution) {
        console.log(`Resolution: ${videoData.resolution}`);
      }
      if (videoData.jitter !== undefined) {
        console.log(`Jitter: ${videoData.jitter.toFixed(5)}ms`);
      }
    });
    console.groupEnd();
  }

  // Console output for audio stream
  if (
    jsonReport.personaAudioStream &&
    jsonReport.personaAudioStream.length > 0
  ) {
    console.group('🔊 Persona Audio Stream (Inbound)');
    jsonReport.personaAudioStream.forEach((audioData) => {
      console.log(
        `Packets Received: ${typeof audioData.packetsReceived === 'number' ? audioData.packetsReceived.toLocaleString() : audioData.packetsReceived}`,
      );
      console.log(`Packets Lost: ${audioData.packetsLost}`);
      console.log(`Audio Level: ${audioData.audioLevel}`);
      if (audioData.jitter !== undefined) {
        console.log(`Jitter: ${audioData.jitter.toFixed(5)}ms`);
      }
      if (audioData.totalAudioEnergy !== undefined) {
        console.log(
          `Total Audio Energy: ${audioData.totalAudioEnergy.toFixed(6)}`,
        );
      }
    });
    console.groupEnd();
  }

  // Console output for user audio input
  if (jsonReport.userAudioInput && jsonReport.userAudioInput.length > 0) {
    console.group('🎤 User Audio Input (Outbound)');
    jsonReport.userAudioInput.forEach((userAudioData) => {
      console.log(
        `Packets Sent: ${typeof userAudioData.packetsSent === 'number' ? userAudioData.packetsSent.toLocaleString() : userAudioData.packetsSent}`,
      );
      if (userAudioData.retransmittedPackets) {
        console.log(
          `Retransmitted Packets: ${userAudioData.retransmittedPackets}`,
        );
      }
      if (userAudioData.avgPacketSendDelay !== undefined) {
        console.log(
          `Avg Packet Send Delay: ${userAudioData.avgPacketSendDelay.toFixed(5)}ms`,
        );
      }
    });
    console.groupEnd();
  }

  // Console output for codecs
  if (jsonReport.codecs && jsonReport.codecs.length > 0) {
    console.group('🔧 Codecs Used');
    jsonReport.codecs.forEach((codecData) => {
      console.log(
        `${codecData.status} ${codecData.mimeType} - Payload Type: ${codecData.payloadType}`,
      );
      if (codecData.clockRate) {
        console.log(`  Clock Rate: ${codecData.clockRate}Hz`);
      }
      if (codecData.channels) {
        console.log(`  Channels: ${codecData.channels}`);
      }
    });
    console.groupEnd();
  }

  // Console output for transport layer
  if (jsonReport.transportLayer && jsonReport.transportLayer.length > 0) {
    console.group('🚚 Transport Layer');
    jsonReport.transportLayer.forEach((transportData) => {
      console.log(`DTLS State: ${transportData.dtlsState}`);
      console.log(`ICE State: ${transportData.iceState}`);
      if (transportData.bytesReceived || transportData.bytesSent) {
        console.log(
          `Data Transfer (bytes) - Sent: ${(transportData.bytesSent || 0).toLocaleString()}, Received: ${(transportData.bytesReceived || 0).toLocaleString()}`,
        );
      }
    });
    console.groupEnd();
  }

  // Console output for issues
  if (jsonReport.issues.length > 0) {
    console.group('⚠️ Potential Issues Detected');
    jsonReport.issues.forEach((issue) => console.warn(issue));
    console.groupEnd();
  } else {
    console.log('✅ No significant issues detected');
  }

  console.groupEnd();
};
