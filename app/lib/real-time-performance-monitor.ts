/**
 * Real-Time Performance Monitor
 * 
 * Provides real-time monitoring, alerting, and automatic adaptation for WebRTC connections.
 * Integrates with the performance metrics collector to provide live feedback and optimization.
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 * - Real-time connection monitoring
 * - Automatic performance alerts
 * - Network adaptation triggers
 * - Performance degradation detection
 */

import {
  performanceMetricsCollector,
  getPerformanceStatistics,
  getNetworkAdaptations,
  getPerformanceAlerts,
  type PerformanceAlert,
  type PerformanceStats,
  type ConnectionMetrics
} from './performance-metrics-collector';

import { WebRTCManager } from './webrtc-manager';

export interface RealTimeMonitorConfig {
  alertThresholds: {
    connectionTimeWarning: number; // ms
    connectionTimeError: number; // ms
    packetLossWarning: number; // percentage (0-1)
    packetLossError: number; // percentage (0-1)
    latencyWarning: number; // ms
    latencyError: number; // ms
    jitterWarning: number; // ms
    jitterError: number; // ms
  };
  monitoringInterval: number; // ms
  adaptationCooldown: number; // ms
  maxConsecutiveFailures: number;
  enableAutoAdaptation: boolean;
  enableRealTimeAlerts: boolean;
}

export interface RealTimeMetrics {
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  currentLatency: number;
  currentPacketLoss: number;
  currentJitter: number;
  bandwidth: number;
  connectionState: string;
  iceConnectionState: string;
  timestamp: number;
  trends: {
    latencyTrend: 'improving' | 'stable' | 'degrading';
    packetLossTrend: 'improving' | 'stable' | 'degrading';
    overallTrend: 'improving' | 'stable' | 'degrading';
  };
}

export interface PerformanceAdaptation {
  type: 'ice-config' | 'media-quality' | 'timeout-adjustment' | 'network-strategy';
  action: string;
  reason: string;
  timestamp: number;
  expectedImprovement: string;
}

export type AlertCallback = (alert: PerformanceAlert) => void;
export type MetricsCallback = (metrics: RealTimeMetrics) => void;
export type AdaptationCallback = (adaptation: PerformanceAdaptation) => void;

/**
 * Real-Time Performance Monitor
 * 
 * Monitors WebRTC connections in real-time and provides automatic optimization
 * and alerting based on performance metrics and network conditions.
 */
export class RealTimePerformanceMonitor {
  private config: RealTimeMonitorConfig;
  private isMonitoring = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private currentPeerConnection: RTCPeerConnection | null = null;
  private lastAdaptationTime = 0;
  private consecutiveFailures = 0;
  private metricsHistory: RealTimeMetrics[] = [];
  private maxHistorySize = 100;

  // Callbacks
  private alertCallbacks: AlertCallback[] = [];
  private metricsCallbacks: MetricsCallback[] = [];
  private adaptationCallbacks: AdaptationCallback[] = [];

  // Performance tracking
  private lastMetrics: RealTimeMetrics | null = null;
  private performanceTrends: {
    latency: number[];
    packetLoss: number[];
    jitter: number[];
  } = {
    latency: [],
    packetLoss: [],
    jitter: []
  };

  constructor(config?: Partial<RealTimeMonitorConfig>) {
    this.config = {
      alertThresholds: {
        connectionTimeWarning: 5000, // 5 seconds
        connectionTimeError: 8000, // 8 seconds
        packetLossWarning: 0.02, // 2%
        packetLossError: 0.05, // 5%
        latencyWarning: 150, // 150ms
        latencyError: 300, // 300ms
        jitterWarning: 50, // 50ms
        jitterError: 100, // 100ms
      },
      monitoringInterval: 1000, // 1 second
      adaptationCooldown: 10000, // 10 seconds
      maxConsecutiveFailures: 3,
      enableAutoAdaptation: true,
      enableRealTimeAlerts: true,
      ...config
    };
  }

  /**
   * Start monitoring a WebRTC peer connection
   * Requirements: 10.1, 10.4 - Real-time connection monitoring and alerts
   */
  startMonitoring(peerConnection: RTCPeerConnection): void {
    if (this.isMonitoring) {
      console.warn('⚠️ Performance monitor already running, stopping previous monitoring');
      this.stopMonitoring();
    }

    this.currentPeerConnection = peerConnection;
    this.isMonitoring = true;
    this.consecutiveFailures = 0;
    this.metricsHistory = [];
    this.performanceTrends = { latency: [], packetLoss: [], jitter: [] };

    console.log('📊 Started real-time performance monitoring');

    // Start monitoring loop
    this.monitoringInterval = setInterval(() => {
      this.performMonitoringCycle();
    }, this.config.monitoringInterval);

    // Monitor connection state changes
    this.setupConnectionStateMonitoring(peerConnection);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;
    this.currentPeerConnection = null;
    
    console.log('📊 Stopped real-time performance monitoring');
  }

  /**
   * Register callback for performance alerts
   * Requirements: 10.4 - Real-time alerting system
   */
  onAlert(callback: AlertCallback): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Register callback for metrics updates
   * Requirements: 10.1 - Real-time metrics reporting
   */
  onMetricsUpdate(callback: MetricsCallback): void {
    this.metricsCallbacks.push(callback);
  }

  /**
   * Register callback for performance adaptations
   * Requirements: 10.3 - Network adaptation notifications
   */
  onAdaptation(callback: AdaptationCallback): void {
    this.adaptationCallbacks.push(callback);
  }

  /**
   * Get current real-time metrics
   */
  getCurrentMetrics(): RealTimeMetrics | null {
    return this.lastMetrics;
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(): RealTimeMetrics[] {
    return [...this.metricsHistory];
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(config: Partial<RealTimeMonitorConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('📊 Updated performance monitor configuration');
  }

  /**
   * Perform a single monitoring cycle
   * Requirements: 10.1, 10.4 - Connection quality monitoring and alerting
   */
  private async performMonitoringCycle(): Promise<void> {
    if (!this.currentPeerConnection || !this.isMonitoring) {
      return;
    }

    try {
      const metrics = await this.collectRealTimeMetrics();
      
      if (metrics) {
        // Store metrics
        this.lastMetrics = metrics;
        this.metricsHistory.push(metrics);
        
        // Trim history
        if (this.metricsHistory.length > this.maxHistorySize) {
          this.metricsHistory = this.metricsHistory.slice(-this.maxHistorySize);
        }

        // Update performance trends
        this.updatePerformanceTrends(metrics);

        // Check for alerts
        if (this.config.enableRealTimeAlerts) {
          this.checkForAlerts(metrics);
        }

        // Check for adaptation needs
        if (this.config.enableAutoAdaptation) {
          this.checkForAdaptationNeeds(metrics);
        }

        // Notify callbacks
        this.metricsCallbacks.forEach(callback => {
          try {
            callback(metrics);
          } catch (error) {
            console.error('❌ Error in metrics callback:', error);
          }
        });
      }

    } catch (error) {
      console.error('❌ Error in monitoring cycle:', error);
      this.consecutiveFailures++;
      
      if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        console.error('🚨 Too many consecutive monitoring failures, stopping monitor');
        this.stopMonitoring();
      }
    }
  }

  /**
   * Collect real-time metrics from peer connection
   * Requirements: 10.1, 10.2 - Real-time metrics collection
   */
  private async collectRealTimeMetrics(): Promise<RealTimeMetrics | null> {
    if (!this.currentPeerConnection) {
      return null;
    }

    try {
      const stats = await this.currentPeerConnection.getStats();
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
      const latencyMs = roundTripTime * 1000;
      const jitterMs = jitter * 1000;

      // Determine connection quality
      const quality = this.determineConnectionQuality(packetLossRate, latencyMs, jitterMs);

      // Calculate trends
      const trends = this.calculateTrends(latencyMs, packetLossRate, jitterMs);

      const metrics: RealTimeMetrics = {
        connectionQuality: quality,
        currentLatency: latencyMs,
        currentPacketLoss: packetLossRate,
        currentJitter: jitterMs,
        bandwidth,
        connectionState: this.currentPeerConnection.connectionState,
        iceConnectionState: this.currentPeerConnection.iceConnectionState,
        timestamp: Date.now(),
        trends
      };

      return metrics;

    } catch (error) {
      console.error('❌ Failed to collect real-time metrics:', error);
      return null;
    }
  }

  /**
   * Determine connection quality based on metrics
   */
  private determineConnectionQuality(
    packetLoss: number, 
    latency: number, 
    jitter: number
  ): RealTimeMetrics['connectionQuality'] {
    const { alertThresholds } = this.config;

    if (packetLoss > alertThresholds.packetLossError || 
        latency > alertThresholds.latencyError || 
        jitter > alertThresholds.jitterError) {
      return 'critical';
    }

    if (packetLoss > alertThresholds.packetLossWarning || 
        latency > alertThresholds.latencyWarning || 
        jitter > alertThresholds.jitterWarning) {
      return 'poor';
    }

    if (packetLoss > alertThresholds.packetLossWarning * 0.5 || 
        latency > alertThresholds.latencyWarning * 0.7 || 
        jitter > alertThresholds.jitterWarning * 0.7) {
      return 'fair';
    }

    if (packetLoss < alertThresholds.packetLossWarning * 0.2 && 
        latency < alertThresholds.latencyWarning * 0.5 && 
        jitter < alertThresholds.jitterWarning * 0.5) {
      return 'excellent';
    }

    return 'good';
  }

  /**
   * Update performance trends
   */
  private updatePerformanceTrends(metrics: RealTimeMetrics): void {
    const maxTrendSize = 10;

    // Update trend arrays
    this.performanceTrends.latency.push(metrics.currentLatency);
    this.performanceTrends.packetLoss.push(metrics.currentPacketLoss);
    this.performanceTrends.jitter.push(metrics.currentJitter);

    // Trim to max size
    if (this.performanceTrends.latency.length > maxTrendSize) {
      this.performanceTrends.latency = this.performanceTrends.latency.slice(-maxTrendSize);
      this.performanceTrends.packetLoss = this.performanceTrends.packetLoss.slice(-maxTrendSize);
      this.performanceTrends.jitter = this.performanceTrends.jitter.slice(-maxTrendSize);
    }
  }

  /**
   * Calculate performance trends
   */
  private calculateTrends(
    currentLatency: number, 
    currentPacketLoss: number, 
    currentJitter: number
  ): RealTimeMetrics['trends'] {
    const calculateTrend = (values: number[]): 'improving' | 'stable' | 'degrading' => {
      if (values.length < 3) return 'stable';

      const recent = values.slice(-3);
      const older = values.slice(-6, -3);
      
      if (older.length === 0) return 'stable';

      const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
      const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;

      const changePercent = (recentAvg - olderAvg) / olderAvg;

      if (changePercent < -0.1) return 'improving';
      if (changePercent > 0.1) return 'degrading';
      return 'stable';
    };

    const latencyTrend = calculateTrend(this.performanceTrends.latency);
    const packetLossTrend = calculateTrend(this.performanceTrends.packetLoss);

    // Overall trend is worst of individual trends
    let overallTrend: 'improving' | 'stable' | 'degrading' = 'improving';
    if (latencyTrend === 'degrading' || packetLossTrend === 'degrading') {
      overallTrend = 'degrading';
    } else if (latencyTrend === 'stable' || packetLossTrend === 'stable') {
      overallTrend = 'stable';
    }

    return {
      latencyTrend,
      packetLossTrend,
      overallTrend
    };
  }

  /**
   * Check for performance alerts
   * Requirements: 10.4 - Real-time performance alerting
   */
  private checkForAlerts(metrics: RealTimeMetrics): void {
    const alerts: PerformanceAlert[] = [];
    const { alertThresholds } = this.config;

    // Check latency alerts
    if (metrics.currentLatency > alertThresholds.latencyError) {
      alerts.push({
        type: 'network-issue',
        severity: 'error',
        message: `High latency detected: ${metrics.currentLatency.toFixed(0)}ms`,
        metrics: this.createAlertMetrics(metrics),
        timestamp: Date.now(),
        recommendations: [
          'Check network connectivity',
          'Consider switching to TURN relay',
          'Reduce video quality if possible'
        ]
      });
    } else if (metrics.currentLatency > alertThresholds.latencyWarning) {
      alerts.push({
        type: 'network-issue',
        severity: 'warning',
        message: `Elevated latency: ${metrics.currentLatency.toFixed(0)}ms`,
        metrics: this.createAlertMetrics(metrics),
        timestamp: Date.now(),
        recommendations: [
          'Monitor network stability',
          'Consider adaptive bitrate'
        ]
      });
    }

    // Check packet loss alerts
    if (metrics.currentPacketLoss > alertThresholds.packetLossError) {
      alerts.push({
        type: 'network-issue',
        severity: 'error',
        message: `High packet loss: ${(metrics.currentPacketLoss * 100).toFixed(1)}%`,
        metrics: this.createAlertMetrics(metrics),
        timestamp: Date.now(),
        recommendations: [
          'Network congestion detected',
          'Reduce video bitrate',
          'Check for network interference'
        ]
      });
    } else if (metrics.currentPacketLoss > alertThresholds.packetLossWarning) {
      alerts.push({
        type: 'network-issue',
        severity: 'warning',
        message: `Packet loss detected: ${(metrics.currentPacketLoss * 100).toFixed(1)}%`,
        metrics: this.createAlertMetrics(metrics),
        timestamp: Date.now(),
        recommendations: [
          'Monitor connection quality',
          'Consider quality adaptation'
        ]
      });
    }

    // Check connection quality degradation
    if (metrics.connectionQuality === 'critical') {
      alerts.push({
        type: 'connection-timeout',
        severity: 'critical',
        message: 'Connection quality is critical',
        metrics: this.createAlertMetrics(metrics),
        timestamp: Date.now(),
        recommendations: [
          'Connection may fail soon',
          'Consider reconnection',
          'Check network stability'
        ]
      });
    }

    // Check for degrading trends
    if (metrics.trends.overallTrend === 'degrading') {
      alerts.push({
        type: 'network-issue',
        severity: 'warning',
        message: 'Connection quality is degrading',
        metrics: this.createAlertMetrics(metrics),
        timestamp: Date.now(),
        recommendations: [
          'Performance trend is negative',
          'Monitor closely for further degradation',
          'Prepare for potential quality reduction'
        ]
      });
    }

    // Notify alert callbacks
    alerts.forEach(alert => {
      this.alertCallbacks.forEach(callback => {
        try {
          callback(alert);
        } catch (error) {
          console.error('❌ Error in alert callback:', error);
        }
      });
    });
  }

  /**
   * Check for adaptation needs
   * Requirements: 10.3 - Automatic network adaptation
   */
  private checkForAdaptationNeeds(metrics: RealTimeMetrics): void {
    const now = Date.now();
    
    // Check cooldown period
    if (now - this.lastAdaptationTime < this.config.adaptationCooldown) {
      return;
    }

    const adaptations: PerformanceAdaptation[] = [];

    // Check for quality reduction needs
    if (metrics.connectionQuality === 'poor' || metrics.connectionQuality === 'critical') {
      adaptations.push({
        type: 'media-quality',
        action: 'reduce-video-quality',
        reason: `Connection quality is ${metrics.connectionQuality}`,
        timestamp: now,
        expectedImprovement: 'Reduced bandwidth usage should improve stability'
      });
    }

    // Check for TURN relay needs
    if (metrics.currentPacketLoss > this.config.alertThresholds.packetLossError) {
      adaptations.push({
        type: 'network-strategy',
        action: 'force-turn-relay',
        reason: `High packet loss: ${(metrics.currentPacketLoss * 100).toFixed(1)}%`,
        timestamp: now,
        expectedImprovement: 'TURN relay should provide more stable connection'
      });
    }

    // Check for timeout adjustments
    if (metrics.trends.overallTrend === 'degrading') {
      adaptations.push({
        type: 'timeout-adjustment',
        action: 'reduce-ice-timeout',
        reason: 'Performance trend is degrading',
        timestamp: now,
        expectedImprovement: 'Faster fallback to TURN relay'
      });
    }

    // Apply adaptations
    if (adaptations.length > 0) {
      this.lastAdaptationTime = now;
      
      adaptations.forEach(adaptation => {
        console.log(`📊 Performance adaptation: ${adaptation.action} - ${adaptation.reason}`);
        
        this.adaptationCallbacks.forEach(callback => {
          try {
            callback(adaptation);
          } catch (error) {
            console.error('❌ Error in adaptation callback:', error);
          }
        });
      });
    }
  }

  /**
   * Setup connection state monitoring
   */
  private setupConnectionStateMonitoring(peerConnection: RTCPeerConnection): void {
    const handleStateChange = () => {
      if (!this.isMonitoring) return;

      const connectionState = peerConnection.connectionState;
      const iceConnectionState = peerConnection.iceConnectionState;

      console.log(`📊 Connection state change: ${connectionState}/${iceConnectionState}`);

      // Handle connection failures
      if (connectionState === 'failed' || iceConnectionState === 'failed') {
        this.alertCallbacks.forEach(callback => {
          try {
            callback({
              type: 'connection-timeout',
              severity: 'critical',
              message: `Connection failed: ${connectionState}/${iceConnectionState}`,
              metrics: this.createAlertMetrics(),
              timestamp: Date.now(),
              recommendations: [
                'Connection has failed',
                'Reconnection required',
                'Check network connectivity'
              ]
            });
          } catch (error) {
            console.error('❌ Error in connection failure alert callback:', error);
          }
        });
      }

      // Handle disconnections
      if (connectionState === 'disconnected' || iceConnectionState === 'disconnected') {
        this.alertCallbacks.forEach(callback => {
          try {
            callback({
              type: 'network-issue',
              severity: 'warning',
              message: `Connection disconnected: ${connectionState}/${iceConnectionState}`,
              metrics: this.createAlertMetrics(),
              timestamp: Date.now(),
              recommendations: [
                'Connection temporarily lost',
                'Monitoring for reconnection',
                'May recover automatically'
              ]
            });
          } catch (error) {
            console.error('❌ Error in disconnection alert callback:', error);
          }
        });
      }
    };

    peerConnection.addEventListener('connectionstatechange', handleStateChange);
    peerConnection.addEventListener('iceconnectionstatechange', handleStateChange);
  }

  /**
   * Create alert metrics from current state
   */
  private createAlertMetrics(metrics?: RealTimeMetrics): ConnectionMetrics {
    const currentMetrics = metrics || this.lastMetrics;
    
    return {
      startTime: Date.now() - 5000, // Approximate
      candidateTypes: [],
      networkType: 'unknown',
      iceTransportPolicy: 'all',
      turnServersUsed: 0,
      stunServersUsed: 0,
      success: currentMetrics?.connectionQuality !== 'critical',
      exceededTarget: currentMetrics ? currentMetrics.currentLatency > 5000 : false,
      usedTurnFallback: false,
      hadNetworkIssues: currentMetrics ? currentMetrics.connectionQuality === 'poor' || currentMetrics.connectionQuality === 'critical' : false,
      attemptNumber: 1,
      milestones: {
        connectionStart: Date.now() - 5000
      }
    };
  }
}

/**
 * Global real-time performance monitor instance
 */
export const realTimePerformanceMonitor = new RealTimePerformanceMonitor();

/**
 * Convenience functions for easy integration
 */

/**
 * Start real-time monitoring for a WebRTC connection
 * Requirements: 10.1, 10.4 - Easy integration with real-time monitoring
 */
export function startRealTimeMonitoring(
  peerConnection: RTCPeerConnection,
  config?: Partial<RealTimeMonitorConfig>
): void {
  if (config) {
    realTimePerformanceMonitor.updateConfig(config);
  }
  realTimePerformanceMonitor.startMonitoring(peerConnection);
}

/**
 * Stop real-time monitoring
 */
export function stopRealTimeMonitoring(): void {
  realTimePerformanceMonitor.stopMonitoring();
}

/**
 * Register for real-time performance alerts
 * Requirements: 10.4 - Real-time alerting integration
 */
export function onPerformanceAlert(callback: AlertCallback): void {
  realTimePerformanceMonitor.onAlert(callback);
}

/**
 * Register for real-time metrics updates
 * Requirements: 10.1 - Real-time metrics integration
 */
export function onMetricsUpdate(callback: MetricsCallback): void {
  realTimePerformanceMonitor.onMetricsUpdate(callback);
}

/**
 * Register for performance adaptations
 * Requirements: 10.3 - Network adaptation integration
 */
export function onPerformanceAdaptation(callback: AdaptationCallback): void {
  realTimePerformanceMonitor.onAdaptation(callback);
}

/**
 * Get current real-time metrics
 */
export function getCurrentRealTimeMetrics(): RealTimeMetrics | null {
  return realTimePerformanceMonitor.getCurrentMetrics();
}

/**
 * Get real-time metrics history
 */
export function getRealTimeMetricsHistory(): RealTimeMetrics[] {
  return realTimePerformanceMonitor.getMetricsHistory();
}