/**
 * WebRTC Performance Integration Layer
 * 
 * Integrates the performance metrics collector with existing WebRTC components
 * to provide seamless performance monitoring and alerting.
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 * - Integration with existing WebRTC manager
 * - Automatic performance tracking during connections
 * - Network adaptation based on performance data
 * - Real-time alerting for performance issues
 */

import {
  performanceMetricsCollector,
  startConnectionTiming,
  recordConnectionMilestone,
  recordICECandidateMetrics,
  completeConnectionTiming,
  getPerformanceStatistics,
  getNetworkAdaptations,
  getPerformanceAlerts,
  type ConnectionMetrics,
  type PerformanceAlert,
  type PerformanceStats,
  type NetworkClassification
} from './performance-metrics-collector';

import { WebRTCManager } from './webrtc-manager';
import { turnFirstICEManager, updateConfigurationSuccess } from './turn-first-ice-manager';

/**
 * Enhanced WebRTC Manager with Performance Monitoring
 * 
 * Extends the existing WebRTC manager with integrated performance tracking
 * and automatic optimization based on performance metrics.
 */
export class PerformanceAwareWebRTCManager extends WebRTCManager {
  private currentSessionId?: string;
  private currentUserId?: string;
  private currentAttemptNumber = 1;
  private connectionStartTime?: number;
  private performanceCallbacks: {
    onAlert?: (alert: PerformanceAlert) => void;
    onStatsUpdate?: (stats: PerformanceStats) => void;
    onNetworkAdaptation?: (adaptations: ReturnType<typeof getNetworkAdaptations>) => void;
  } = {};

  /**
   * Set performance monitoring callbacks
   */
  setPerformanceCallbacks(callbacks: typeof this.performanceCallbacks): void {
    this.performanceCallbacks = callbacks;
  }

  /**
   * Start a monitored WebRTC connection
   * Requirements: 10.1 - Connection timing measurement system
   */
  startMonitoredConnection(sessionId: string, userId?: string, attemptNumber: number = 1): void {
    this.currentSessionId = sessionId;
    this.currentUserId = userId;
    this.currentAttemptNumber = attemptNumber;
    this.connectionStartTime = performance.now();

    // Start performance timing
    startConnectionTiming(sessionId, userId, attemptNumber);

    console.log(`📊 Started monitored WebRTC connection for session ${sessionId}, attempt ${attemptNumber}`);
  }

  /**
   * Record media access completion
   * Requirements: 10.1 - Milestone timing tracking
   */
  recordMediaReady(mediaStream: MediaStream): void {
    recordConnectionMilestone('mediaReady', {
      videoTracks: mediaStream.getVideoTracks().length,
      audioTracks: mediaStream.getAudioTracks().length
    });

    console.log(`📊 Media ready: ${mediaStream.getVideoTracks().length} video, ${mediaStream.getAudioTracks().length} audio tracks`);
  }

  /**
   * Record ICE gathering start
   * Requirements: 10.1 - ICE gathering timing
   */
  recordICEGatheringStart(iceConfig: RTCConfiguration): void {
    const turnServers = iceConfig.iceServers?.filter(server => 
      (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('turn')) : server.urls.startsWith('turn'))
    ).length || 0;

    const stunServers = iceConfig.iceServers?.filter(server => 
      (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('stun')) : server.urls.startsWith('stun'))
    ).length || 0;

    recordConnectionMilestone('iceGatheringStart', {
      iceTransportPolicy: iceConfig.iceTransportPolicy,
      turnServersUsed: turnServers,
      stunServersUsed: stunServers,
      iceCandidatePoolSize: iceConfig.iceCandidatePoolSize
    });

    console.log(`📊 ICE gathering started: ${turnServers} TURN, ${stunServers} STUN servers`);
  }

  /**
   * Record ICE candidate discovery
   * Requirements: 10.2 - ICE candidate type tracking for successful connections
   */
  recordICECandidate(candidate: RTCIceCandidate, isSuccessful: boolean = false): void {
    recordICECandidateMetrics(candidate, isSuccessful);

    if (isSuccessful) {
      console.log(`📊 Successful ICE candidate: ${candidate.candidate}`);
    }

    // Record first candidate milestone if this is the first one
    if (!isSuccessful) {
      recordConnectionMilestone('firstCandidate');
    }
  }

  /**
   * Record TURN fallback activation
   * Requirements: 10.1 - TURN fallback timing
   */
  recordTURNFallback(reason: string): void {
    recordConnectionMilestone('turnFallback', {
      reason,
      networkIssues: true
    });

    console.log(`📊 TURN fallback activated: ${reason}`);
  }

  /**
   * Record connection establishment
   * Requirements: 10.1 - Connection establishment timing
   */
  recordConnectionEstablished(peerConnection: RTCPeerConnection): void {
    recordConnectionMilestone('connectionEstablished', {
      connectionState: peerConnection.connectionState,
      iceConnectionState: peerConnection.iceConnectionState
    });

    console.log(`📊 Connection established: ${peerConnection.connectionState}/${peerConnection.iceConnectionState}`);
  }

  /**
   * Record first remote frame received
   * Requirements: 10.1 - End-to-end timing measurement
   */
  recordFirstRemoteFrame(): void {
    recordConnectionMilestone('firstRemoteFrame');
    console.log(`📊 First remote frame received`);
  }

  /**
   * Complete monitored connection
   * Requirements: 10.1, 10.4 - Complete timing and performance validation
   */
  completeMonitoredConnection(
    success: boolean, 
    failureReason?: string, 
    connectionState?: string, 
    iceConnectionState?: string
  ): ConnectionMetrics {
    const metrics = completeConnectionTiming(success, failureReason, connectionState, iceConnectionState);

    // Update ICE configuration success rate
    if (this.currentSessionId) {
      const networkType = metrics.networkType;
      updateConfigurationSuccess(networkType, success);
    }

    // Trigger callbacks
    if (this.performanceCallbacks.onStatsUpdate) {
      const stats = getPerformanceStatistics();
      this.performanceCallbacks.onStatsUpdate(stats);
    }

    // Check for new alerts
    const recentAlerts = getPerformanceAlerts(1);
    if (recentAlerts.length > 0 && this.performanceCallbacks.onAlert) {
      this.performanceCallbacks.onAlert(recentAlerts[0]);
    }

    // Trigger network adaptation if needed
    if (this.performanceCallbacks.onNetworkAdaptation) {
      const adaptations = getNetworkAdaptations();
      this.performanceCallbacks.onNetworkAdaptation(adaptations);
    }

    console.log(`📊 Completed monitored connection: ${success ? 'SUCCESS' : 'FAILURE'} in ${metrics.totalConnectionTime?.toFixed(2)}ms`);

    return metrics;
  }

  /**
   * Get current performance statistics
   * Requirements: 10.4, 10.5 - Performance reporting
   */
  getPerformanceStatistics(): PerformanceStats {
    return getPerformanceStatistics();
  }

  /**
   * Get network adaptation recommendations
   * Requirements: 10.3 - Network type classification and adaptation
   */
  getNetworkAdaptations(): ReturnType<typeof getNetworkAdaptations> {
    return getNetworkAdaptations();
  }

  /**
   * Get recent performance alerts
   * Requirements: 10.4 - Performance alerts
   */
  getPerformanceAlerts(limit?: number): PerformanceAlert[] {
    return getPerformanceAlerts(limit);
  }

  /**
   * Apply network adaptations to ICE configuration
   * Requirements: 10.3 - Network adaptation implementation
   */
  applyNetworkAdaptations(): RTCConfiguration {
    const adaptations = this.getNetworkAdaptations();
    const { configurationSuggestions } = adaptations;

    // Get optimized configuration based on current network
    const optimizedConfig = turnFirstICEManager.generateOptimizedConfig(adaptations.currentNetwork.type);

    // Apply performance-based adaptations
    const adaptedConfig: RTCConfiguration = {
      ...optimizedConfig,
      iceTransportPolicy: configurationSuggestions.iceTransportPolicy,
      iceCandidatePoolSize: configurationSuggestions.iceCandidatePoolSize
    };

    console.log(`📊 Applied network adaptations for ${adaptations.currentNetwork.type} network`);
    console.log(`📊 Configuration: policy=${adaptedConfig.iceTransportPolicy}, pool=${adaptedConfig.iceCandidatePoolSize}`);

    return adaptedConfig;
  }

  /**
   * Monitor connection quality during established connection
   * Requirements: 10.4 - Ongoing performance monitoring
   */
  async monitorConnectionQuality(peerConnection: RTCPeerConnection): Promise<{
    quality: 'good' | 'fair' | 'poor';
    metrics: {
      packetsLost: number;
      packetsReceived: number;
      roundTripTime: number;
      jitter: number;
      bandwidth: number;
    };
    recommendations: string[];
  }> {
    try {
      const stats = await peerConnection.getStats();
      let packetsLost = 0;
      let packetsReceived = 0;
      let roundTripTime = 0;
      let jitter = 0;
      let bandwidth = 0;

      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
          packetsLost += report.packetsLost || 0;
          packetsReceived += report.packetsReceived || 0;
          jitter += report.jitter || 0;
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          roundTripTime = report.currentRoundTripTime || 0;
          bandwidth = report.availableOutgoingBitrate || 0;
        }
      });

      const packetLossRate = packetsReceived > 0 ? packetsLost / (packetsLost + packetsReceived) : 0;
      
      let quality: 'good' | 'fair' | 'poor' = 'good';
      const recommendations: string[] = [];
      
      if (packetLossRate > 0.05 || roundTripTime > 0.3 || jitter > 0.1) {
        quality = 'poor';
        recommendations.push('Consider reducing video quality');
        recommendations.push('Check network stability');
        if (packetLossRate > 0.05) {
          recommendations.push(`High packet loss: ${(packetLossRate * 100).toFixed(1)}%`);
        }
        if (roundTripTime > 0.3) {
          recommendations.push(`High latency: ${(roundTripTime * 1000).toFixed(0)}ms`);
        }
      } else if (packetLossRate > 0.02 || roundTripTime > 0.15 || jitter > 0.05) {
        quality = 'fair';
        recommendations.push('Monitor connection stability');
        recommendations.push('Consider adaptive bitrate');
      }

      const metrics = {
        packetsLost,
        packetsReceived,
        roundTripTime,
        jitter,
        bandwidth
      };

      console.log(`📊 Connection quality: ${quality}, loss: ${(packetLossRate * 100).toFixed(1)}%, RTT: ${(roundTripTime * 1000).toFixed(0)}ms`);

      return { quality, metrics, recommendations };

    } catch (error) {
      console.error('❌ Failed to monitor connection quality:', error);
      return {
        quality: 'poor',
        metrics: { packetsLost: 0, packetsReceived: 0, roundTripTime: 0, jitter: 0, bandwidth: 0 },
        recommendations: ['Unable to monitor connection quality', 'Check WebRTC connection status']
      };
    }
  }

  /**
   * Generate performance report for debugging
   * Requirements: 10.5 - Performance reporting and analysis
   */
  generatePerformanceReport(): {
    summary: PerformanceStats;
    recentAlerts: PerformanceAlert[];
    networkAdaptations: ReturnType<typeof getNetworkAdaptations>;
    recommendations: string[];
    exportData: ReturnType<typeof performanceMetricsCollector.exportMetrics>;
  } {
    const summary = this.getPerformanceStatistics();
    const recentAlerts = this.getPerformanceAlerts(10);
    const networkAdaptations = this.getNetworkAdaptations();
    const exportData = performanceMetricsCollector.exportMetrics();

    const recommendations: string[] = [];

    // Generate recommendations based on performance
    if (summary.targetSuccessRate < 0.9) {
      recommendations.push(`Target success rate is ${(summary.targetSuccessRate * 100).toFixed(1)}% (target: 90%)`);
      recommendations.push('Consider more aggressive TURN-first strategy');
    }

    if (summary.averageConnectionTime > 5000) {
      recommendations.push(`Average connection time is ${summary.averageConnectionTime.toFixed(0)}ms (target: ≤5000ms)`);
      recommendations.push('Review ICE gathering timeout settings');
    }

    if (recentAlerts.length > 0) {
      const criticalAlerts = recentAlerts.filter(a => a.severity === 'critical').length;
      const errorAlerts = recentAlerts.filter(a => a.severity === 'error').length;
      
      if (criticalAlerts > 0) {
        recommendations.push(`${criticalAlerts} critical alerts in recent connections`);
        recommendations.push('Investigate network connectivity issues');
      }
      
      if (errorAlerts > 0) {
        recommendations.push(`${errorAlerts} error alerts in recent connections`);
        recommendations.push('Review connection configuration');
      }
    }

    // Add network-specific recommendations
    recommendations.push(...networkAdaptations.recommendations);

    console.log(`📊 Generated performance report: ${summary.totalConnections} connections, ${(summary.successRate * 100).toFixed(1)}% success rate`);

    return {
      summary,
      recentAlerts,
      networkAdaptations,
      recommendations,
      exportData
    };
  }
}

/**
 * Global performance-aware WebRTC manager instance
 */
export const performanceAwareWebRTCManager = new PerformanceAwareWebRTCManager();

/**
 * Convenience functions for easy integration with existing code
 */

/**
 * Initialize performance monitoring for a WebRTC connection
 * Requirements: 10.1 - Easy integration with existing connection code
 */
export function initializePerformanceMonitoring(
  sessionId: string, 
  userId?: string, 
  attemptNumber?: number,
  callbacks?: {
    onAlert?: (alert: PerformanceAlert) => void;
    onStatsUpdate?: (stats: PerformanceStats) => void;
    onNetworkAdaptation?: (adaptations: ReturnType<typeof getNetworkAdaptations>) => void;
  }
): void {
  if (callbacks) {
    performanceAwareWebRTCManager.setPerformanceCallbacks(callbacks);
  }
  
  performanceAwareWebRTCManager.startMonitoredConnection(sessionId, userId, attemptNumber);
}

/**
 * Get optimized WebRTC configuration with performance adaptations
 * Requirements: 10.3 - Network-adapted configuration
 */
export function getPerformanceOptimizedConfig(): RTCConfiguration {
  return performanceAwareWebRTCManager.applyNetworkAdaptations();
}

/**
 * Record WebRTC connection milestones for performance tracking
 * Requirements: 10.1, 10.2 - Milestone and candidate tracking
 */
export const recordPerformanceMilestone = {
  mediaReady: (mediaStream: MediaStream) => performanceAwareWebRTCManager.recordMediaReady(mediaStream),
  iceGatheringStart: (config: RTCConfiguration) => performanceAwareWebRTCManager.recordICEGatheringStart(config),
  iceCandidate: (candidate: RTCIceCandidate, isSuccessful?: boolean) => performanceAwareWebRTCManager.recordICECandidate(candidate, isSuccessful),
  turnFallback: (reason: string) => performanceAwareWebRTCManager.recordTURNFallback(reason),
  connectionEstablished: (peerConnection: RTCPeerConnection) => performanceAwareWebRTCManager.recordConnectionEstablished(peerConnection),
  firstRemoteFrame: () => performanceAwareWebRTCManager.recordFirstRemoteFrame(),
  complete: (success: boolean, failureReason?: string, connectionState?: string, iceConnectionState?: string) => 
    performanceAwareWebRTCManager.completeMonitoredConnection(success, failureReason, connectionState, iceConnectionState)
};

/**
 * Monitor ongoing connection quality
 * Requirements: 10.4 - Connection quality monitoring
 */
export function monitorConnectionQuality(peerConnection: RTCPeerConnection) {
  return performanceAwareWebRTCManager.monitorConnectionQuality(peerConnection);
}

/**
 * Get comprehensive performance report
 * Requirements: 10.5 - Performance reporting
 */
export function getPerformanceReport(): ReturnType<typeof performanceAwareWebRTCManager.generatePerformanceReport> {
  return performanceAwareWebRTCManager.generatePerformanceReport();
}

/**
 * Performance monitoring hooks for React components
 */
export const usePerformanceMonitoring = () => {
  return {
    initializeMonitoring: initializePerformanceMonitoring,
    recordMilestone: recordPerformanceMilestone,
    getOptimizedConfig: getPerformanceOptimizedConfig,
    monitorQuality: monitorConnectionQuality,
    getReport: getPerformanceReport,
    getStats: () => performanceAwareWebRTCManager.getPerformanceStatistics(),
    getAlerts: (limit?: number) => performanceAwareWebRTCManager.getPerformanceAlerts(limit),
    getAdaptations: () => performanceAwareWebRTCManager.getNetworkAdaptations()
  };
};

// Export types for external use
export type { PerformanceAlert, PerformanceStats } from './performance-metrics-collector';