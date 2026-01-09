/**
 * Performance Metrics Collector
 * 
 * Implements comprehensive connection performance monitoring and metrics collection
 * for WebRTC connection optimization validation and ongoing performance tracking.
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 * - Connection timing measurement system
 * - ICE candidate type tracking for successful connections
 * - Network type classification and adaptation
 * - Performance alerts for connections exceeding 5-second target
 */

export interface ConnectionMetrics {
  // Timing measurements
  startTime: number;
  mediaReadyTime?: number;
  iceGatheringStartTime?: number;
  firstCandidateTime?: number;
  turnFallbackTime?: number;
  connectionEstablishedTime?: number;
  firstRemoteFrameTime?: number;
  totalConnectionTime?: number;
  
  // Connection details
  candidateTypes: string[];
  successfulCandidateType?: string;
  networkType: 'mobile' | 'wifi' | 'unknown';
  iceTransportPolicy: 'all' | 'relay';
  turnServersUsed: number;
  stunServersUsed: number;
  
  // Success/failure tracking
  success: boolean;
  failureReason?: string;
  connectionState?: string;
  iceConnectionState?: string;
  
  // Performance flags
  exceededTarget: boolean;
  usedTurnFallback: boolean;
  hadNetworkIssues: boolean;
  
  // Session context
  sessionId?: string;
  userId?: string;
  attemptNumber: number;
  
  // Timestamps for detailed analysis
  milestones: {
    [key: string]: number;
  };
}

export interface PerformanceAlert {
  type: 'connection-timeout' | 'turn-fallback' | 'network-issue' | 'repeated-failure';
  severity: 'warning' | 'error' | 'critical';
  message: string;
  metrics: ConnectionMetrics;
  timestamp: number;
  recommendations: string[];
}

export interface NetworkClassification {
  type: 'mobile' | 'wifi' | 'unknown';
  confidence: number;
  indicators: string[];
  adaptations: string[];
}

export interface PerformanceStats {
  totalConnections: number;
  successfulConnections: number;
  successRate: number;
  averageConnectionTime: number;
  medianConnectionTime: number;
  percentile95ConnectionTime: number;
  connectionsUnder5Seconds: number;
  targetSuccessRate: number;
  
  // By network type
  byNetworkType: {
    [key: string]: {
      connections: number;
      successRate: number;
      averageTime: number;
      targetSuccessRate: number;
    };
  };
  
  // By candidate type
  byCandidateType: {
    [key: string]: {
      connections: number;
      successRate: number;
      averageTime: number;
    };
  };
  
  // Recent performance
  last24Hours: {
    connections: number;
    successRate: number;
    averageTime: number;
  };
  
  // Alerts summary
  alerts: {
    total: number;
    byType: { [key: string]: number };
    bySeverity: { [key: string]: number };
  };
}

/**
 * Performance Metrics Collector
 * 
 * Centralized system for collecting, analyzing, and reporting WebRTC connection
 * performance metrics with real-time alerting and network adaptation.
 */
export class PerformanceMetricsCollector {
  private metrics: ConnectionMetrics[] = [];
  private alerts: PerformanceAlert[] = [];
  private currentMetrics: ConnectionMetrics | null = null;
  private maxMetricsHistory = 1000; // Keep last 1000 connections
  private maxAlertsHistory = 100; // Keep last 100 alerts
  
  // Performance targets
  private readonly TARGET_CONNECTION_TIME = 5000; // 5 seconds
  private readonly TARGET_SUCCESS_RATE = 0.9; // 90%
  
  /**
   * Start timing a new connection attempt
   * Requirements: 10.1 - Connection establishment timing measurement
   */
  startConnectionTiming(sessionId?: string, userId?: string, attemptNumber: number = 1): void {
    const startTime = performance.now();
    
    this.currentMetrics = {
      startTime,
      candidateTypes: [],
      networkType: this.classifyNetwork().type,
      iceTransportPolicy: 'all',
      turnServersUsed: 0,
      stunServersUsed: 0,
      success: false,
      exceededTarget: false,
      usedTurnFallback: false,
      hadNetworkIssues: false,
      sessionId,
      userId,
      attemptNumber,
      milestones: {
        connectionStart: startTime
      }
    };
    
    console.log(`📊 Started connection timing for session ${sessionId}, attempt ${attemptNumber}`);
  }
  
  /**
   * Record a milestone timestamp during connection establishment
   * Requirements: 10.1 - Detailed timing measurement
   */
  recordMilestone(milestone: keyof ConnectionMetrics | string, additionalData?: any): void {
    if (!this.currentMetrics) {
      console.warn('⚠️ Cannot record milestone: No active connection timing');
      return;
    }
    
    const timestamp = performance.now();
    const relativeTime = timestamp - this.currentMetrics.startTime;
    
    // Record in milestones for detailed analysis
    this.currentMetrics.milestones[milestone] = timestamp;
    
    // Update specific metric fields
    switch (milestone) {
      case 'mediaReady':
        this.currentMetrics.mediaReadyTime = timestamp;
        break;
      case 'iceGatheringStart':
        this.currentMetrics.iceGatheringStartTime = timestamp;
        break;
      case 'firstCandidate':
        this.currentMetrics.firstCandidateTime = timestamp;
        break;
      case 'turnFallback':
        this.currentMetrics.turnFallbackTime = timestamp;
        this.currentMetrics.usedTurnFallback = true;
        break;
      case 'connectionEstablished':
        this.currentMetrics.connectionEstablishedTime = timestamp;
        break;
      case 'firstRemoteFrame':
        this.currentMetrics.firstRemoteFrameTime = timestamp;
        break;
    }
    
    // Store additional data if provided
    if (additionalData) {
      if (additionalData.candidateType) {
        this.currentMetrics.candidateTypes.push(additionalData.candidateType);
      }
      if (additionalData.iceTransportPolicy) {
        this.currentMetrics.iceTransportPolicy = additionalData.iceTransportPolicy;
      }
      if (additionalData.turnServersUsed !== undefined) {
        this.currentMetrics.turnServersUsed = additionalData.turnServersUsed;
      }
      if (additionalData.stunServersUsed !== undefined) {
        this.currentMetrics.stunServersUsed = additionalData.stunServersUsed;
      }
    }
    
    console.log(`📊 Recorded milestone '${milestone}' at ${relativeTime.toFixed(2)}ms`);
    
    // Check for performance alerts
    this.checkPerformanceAlerts(milestone, relativeTime);
  }
  
  /**
   * Record ICE candidate information for tracking
   * Requirements: 10.2 - ICE candidate type tracking for successful connections
   */
  recordICECandidate(candidate: RTCIceCandidate, isSuccessful: boolean = false): void {
    if (!this.currentMetrics) {
      return;
    }
    
    const candidateType = this.classifyICECandidate(candidate);
    
    // Add to candidate types list
    if (!this.currentMetrics.candidateTypes.includes(candidateType)) {
      this.currentMetrics.candidateTypes.push(candidateType);
    }
    
    // Track successful candidate type
    if (isSuccessful) {
      this.currentMetrics.successfulCandidateType = candidateType;
      console.log(`📊 Successful connection using ${candidateType} candidate`);
    }
    
    // Update server usage counts
    if (candidateType.includes('turn')) {
      this.currentMetrics.turnServersUsed++;
    } else if (candidateType.includes('stun') || candidateType.includes('srflx')) {
      this.currentMetrics.stunServersUsed++;
    }
  }
  
  /**
   * Complete connection timing and finalize metrics
   * Requirements: 10.1, 10.4 - Complete timing measurement and performance validation
   */
  completeConnectionTiming(success: boolean, failureReason?: string, connectionState?: string, iceConnectionState?: string): ConnectionMetrics {
    if (!this.currentMetrics) {
      throw new Error('No active connection timing to complete');
    }
    
    const endTime = performance.now();
    const totalTime = endTime - this.currentMetrics.startTime;
    
    // Finalize metrics
    this.currentMetrics.totalConnectionTime = totalTime;
    this.currentMetrics.success = success;
    this.currentMetrics.failureReason = failureReason;
    this.currentMetrics.connectionState = connectionState;
    this.currentMetrics.iceConnectionState = iceConnectionState;
    this.currentMetrics.exceededTarget = totalTime > this.TARGET_CONNECTION_TIME;
    
    // Record final milestone
    this.currentMetrics.milestones.connectionEnd = endTime;
    
    // Add to metrics history
    this.metrics.push({ ...this.currentMetrics });
    
    // Trim history if needed
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.maxMetricsHistory);
    }
    
    // Generate performance alerts if needed
    this.generatePerformanceAlerts(this.currentMetrics);
    
    const completedMetrics = { ...this.currentMetrics };
    
    console.log(`📊 Connection timing completed: ${success ? 'SUCCESS' : 'FAILURE'} in ${totalTime.toFixed(2)}ms`);
    if (success && totalTime <= this.TARGET_CONNECTION_TIME) {
      console.log(`✅ Connection met performance target (≤${this.TARGET_CONNECTION_TIME}ms)`);
    } else if (success) {
      console.log(`⚠️ Connection exceeded performance target (${totalTime.toFixed(2)}ms > ${this.TARGET_CONNECTION_TIME}ms)`);
    }
    
    // Reset current metrics
    this.currentMetrics = null;
    
    return completedMetrics;
  }
  
  /**
   * Classify network type based on available information
   * Requirements: 10.3 - Network type classification and adaptation
   */
  classifyNetwork(): NetworkClassification {
    const indicators: string[] = [];
    const adaptations: string[] = [];
    let type: 'mobile' | 'wifi' | 'unknown' = 'unknown';
    let confidence = 0.5;
    
    try {
      // Check for Network Information API (limited browser support)
      if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        
        if (connection) {
          const effectiveType = connection.effectiveType;
          const type_connection = connection.type;
          
          // Mobile network indicators
          if (effectiveType === '4g' || effectiveType === '3g' || effectiveType === '2g') {
            indicators.push(`Effective type: ${effectiveType}`);
            type = 'mobile';
            confidence = 0.8;
            adaptations.push('Use TURN-first strategy');
            adaptations.push('Prefer relay candidates');
          }
          
          // WiFi indicators
          if (type_connection === 'wifi') {
            indicators.push('Connection type: WiFi');
            type = 'wifi';
            confidence = 0.9;
            adaptations.push('Use parallel STUN/TURN gathering');
            adaptations.push('Allow all transport types');
          }
          
          // Cellular indicators
          if (type_connection === 'cellular') {
            indicators.push('Connection type: Cellular');
            type = 'mobile';
            confidence = 0.9;
            adaptations.push('Force TURN relay mode');
            adaptations.push('Aggressive timeout control');
          }
        }
      }
      
      // Fallback: Check user agent for mobile indicators
      if (type === 'unknown') {
        const userAgent = navigator.userAgent.toLowerCase();
        const mobileKeywords = ['mobile', 'android', 'iphone', 'ipad', 'tablet'];
        
        if (mobileKeywords.some(keyword => userAgent.includes(keyword))) {
          indicators.push('Mobile user agent detected');
          type = 'mobile';
          confidence = 0.6;
          adaptations.push('Assume mobile network constraints');
        } else {
          indicators.push('Desktop user agent detected');
          type = 'wifi';
          confidence = 0.6;
          adaptations.push('Assume WiFi network');
        }
      }
      
      // Additional heuristics based on screen size
      if (window.screen && window.screen.width < 768) {
        indicators.push('Small screen size detected');
        if ((type as string) === 'unknown') {
          type = 'mobile';
          confidence = 0.5;
        } else if (type === 'mobile') {
          confidence = Math.min(confidence + 0.1, 1.0);
        }
      }
      
    } catch (error) {
      console.warn('⚠️ Network classification failed:', error);
      indicators.push('Classification failed - using defaults');
      adaptations.push('Use conservative TURN-first strategy');
    }
    
    return {
      type,
      confidence,
      indicators,
      adaptations
    };
  }
  
  /**
   * Classify ICE candidate type for tracking
   * Requirements: 10.2 - ICE candidate type tracking
   */
  private classifyICECandidate(candidate: RTCIceCandidate): string {
    const candidateStr = candidate.candidate;
    
    if (candidateStr.includes('typ host')) {
      return 'host';
    } else if (candidateStr.includes('typ srflx')) {
      return 'stun-srflx';
    } else if (candidateStr.includes('typ relay')) {
      if (candidateStr.includes('udp')) {
        return 'turn-relay-udp';
      } else if (candidateStr.includes('tcp')) {
        return 'turn-relay-tcp';
      } else {
        return 'turn-relay';
      }
    } else if (candidateStr.includes('typ prflx')) {
      return 'peer-reflexive';
    } else {
      return 'unknown';
    }
  }
  
  /**
   * Check for performance alerts during connection
   * Requirements: 10.4 - Performance alerts for connections exceeding targets
   */
  private checkPerformanceAlerts(milestone: string, relativeTime: number): void {
    if (!this.currentMetrics) return;
    
    // Alert if ICE gathering is taking too long
    if (milestone === 'iceGatheringStart' && relativeTime > 2000) {
      this.generateAlert({
        type: 'connection-timeout',
        severity: 'warning',
        message: `ICE gathering started late at ${relativeTime.toFixed(2)}ms`,
        recommendations: [
          'Check media access performance',
          'Verify TURN server availability',
          'Consider pre-warming ICE candidates'
        ]
      });
    }
    
    // Alert if no candidates found quickly
    if (milestone === 'firstCandidate' && relativeTime > 3000) {
      this.generateAlert({
        type: 'connection-timeout',
        severity: 'warning',
        message: `First ICE candidate found late at ${relativeTime.toFixed(2)}ms`,
        recommendations: [
          'Check network connectivity',
          'Verify STUN/TURN server configuration',
          'Consider network-specific optimizations'
        ]
      });
    }
    
    // Alert if TURN fallback is triggered
    if (milestone === 'turnFallback') {
      this.generateAlert({
        type: 'turn-fallback',
        severity: 'warning',
        message: `TURN fallback triggered at ${relativeTime.toFixed(2)}ms`,
        recommendations: [
          'Network may be restrictive (CGNAT/Symmetric NAT)',
          'TURN relay mode activated',
          'Monitor for consistent TURN usage patterns'
        ]
      });
    }
    
    // Alert if connection establishment is slow
    if (milestone === 'connectionEstablished' && relativeTime > this.TARGET_CONNECTION_TIME) {
      this.generateAlert({
        type: 'connection-timeout',
        severity: 'error',
        message: `Connection established late at ${relativeTime.toFixed(2)}ms (target: ${this.TARGET_CONNECTION_TIME}ms)`,
        recommendations: [
          'Connection exceeded performance target',
          'Review ICE configuration and timeout settings',
          'Consider more aggressive TURN-first strategy'
        ]
      });
    }
  }
  
  /**
   * Generate performance alerts after connection completion
   * Requirements: 10.4 - Performance alerts and recommendations
   */
  private generatePerformanceAlerts(metrics: ConnectionMetrics): void {
    // Alert for failed connections
    if (!metrics.success) {
      this.generateAlert({
        type: 'repeated-failure',
        severity: 'error',
        message: `Connection failed: ${metrics.failureReason || 'Unknown reason'}`,
        recommendations: [
          'Check network connectivity',
          'Verify TURN server availability',
          'Review ICE configuration',
          'Consider fallback strategies'
        ]
      });
    }
    
    // Alert for slow successful connections
    if (metrics.success && metrics.totalConnectionTime && metrics.totalConnectionTime > this.TARGET_CONNECTION_TIME) {
      this.generateAlert({
        type: 'connection-timeout',
        severity: 'warning',
        message: `Slow connection: ${metrics.totalConnectionTime.toFixed(2)}ms (target: ${this.TARGET_CONNECTION_TIME}ms)`,
        recommendations: [
          'Connection succeeded but exceeded performance target',
          'Consider optimizing ICE gathering timeout',
          'Review network-specific configuration'
        ]
      });
    }
    
    // Alert for repeated failures from same user
    if (metrics.userId && metrics.attemptNumber > 2) {
      const recentFailures = this.metrics
        .filter(m => m.userId === metrics.userId && !m.success)
        .slice(-3);
      
      if (recentFailures.length >= 2) {
        this.generateAlert({
          type: 'repeated-failure',
          severity: 'critical',
          message: `User ${metrics.userId} has ${recentFailures.length} recent connection failures`,
          recommendations: [
            'User may have persistent network issues',
            'Consider providing network troubleshooting guidance',
            'Review user-specific connection patterns'
          ]
        });
      }
    }
    
    // Alert for network issues
    if (metrics.hadNetworkIssues) {
      this.generateAlert({
        type: 'network-issue',
        severity: 'warning',
        message: 'Network issues detected during connection',
        recommendations: [
          'Monitor for network instability patterns',
          'Consider adaptive quality settings',
          'Review connection resilience strategies'
        ]
      });
    }
  }
  
  /**
   * Generate and store a performance alert
   */
  private generateAlert(alertData: Omit<PerformanceAlert, 'metrics' | 'timestamp'>): void {
    if (!this.currentMetrics) return;
    
    const alert: PerformanceAlert = {
      ...alertData,
      metrics: { ...this.currentMetrics },
      timestamp: Date.now()
    };
    
    this.alerts.push(alert);
    
    // Trim alerts history if needed
    if (this.alerts.length > this.maxAlertsHistory) {
      this.alerts = this.alerts.slice(-this.maxAlertsHistory);
    }
    
    // Log alert
    const severityEmoji = {
      warning: '⚠️',
      error: '❌',
      critical: '🚨'
    };
    
    console.log(`${severityEmoji[alert.severity]} Performance Alert [${alert.type}]: ${alert.message}`);
    alert.recommendations.forEach(rec => console.log(`   💡 ${rec}`));
  }
  
  /**
   * Get comprehensive performance statistics
   * Requirements: 10.1, 10.2, 10.4, 10.5 - Performance reporting and validation
   */
  getPerformanceStats(): PerformanceStats {
    const now = Date.now();
    const last24Hours = now - (24 * 60 * 60 * 1000);
    
    // Filter recent metrics
    const recentMetrics = this.metrics.filter(m => 
      m.milestones.connectionStart && m.milestones.connectionStart > last24Hours
    );
    
    // Calculate overall stats
    const successfulConnections = this.metrics.filter(m => m.success);
    const connectionTimes = successfulConnections
      .map(m => m.totalConnectionTime)
      .filter(t => t !== undefined) as number[];
    
    connectionTimes.sort((a, b) => a - b);
    
    const totalConnections = this.metrics.length;
    const successRate = totalConnections > 0 ? successfulConnections.length / totalConnections : 0;
    const averageConnectionTime = connectionTimes.length > 0 
      ? connectionTimes.reduce((sum, time) => sum + time, 0) / connectionTimes.length 
      : 0;
    const medianConnectionTime = connectionTimes.length > 0 
      ? connectionTimes[Math.floor(connectionTimes.length / 2)] 
      : 0;
    const percentile95ConnectionTime = connectionTimes.length > 0 
      ? connectionTimes[Math.floor(connectionTimes.length * 0.95)] 
      : 0;
    const connectionsUnder5Seconds = connectionTimes.filter(t => t <= this.TARGET_CONNECTION_TIME).length;
    const targetSuccessRate = connectionsUnder5Seconds / Math.max(totalConnections, 1);
    
    // Stats by network type
    const byNetworkType: { [key: string]: any } = {};
    ['mobile', 'wifi', 'unknown'].forEach(networkType => {
      const networkMetrics = this.metrics.filter(m => m.networkType === networkType);
      const networkSuccessful = networkMetrics.filter(m => m.success);
      const networkTimes = networkSuccessful
        .map(m => m.totalConnectionTime)
        .filter(t => t !== undefined) as number[];
      
      byNetworkType[networkType] = {
        connections: networkMetrics.length,
        successRate: networkMetrics.length > 0 ? networkSuccessful.length / networkMetrics.length : 0,
        averageTime: networkTimes.length > 0 
          ? networkTimes.reduce((sum, time) => sum + time, 0) / networkTimes.length 
          : 0,
        targetSuccessRate: networkTimes.filter(t => t <= this.TARGET_CONNECTION_TIME).length / Math.max(networkMetrics.length, 1)
      };
    });
    
    // Stats by candidate type
    const byCandidateType: { [key: string]: any } = {};
    const candidateTypes = [...new Set(successfulConnections.map(m => m.successfulCandidateType).filter(Boolean))];
    
    candidateTypes.forEach(candidateType => {
      const candidateMetrics = successfulConnections.filter(m => m.successfulCandidateType === candidateType);
      const candidateTimes = candidateMetrics
        .map(m => m.totalConnectionTime)
        .filter(t => t !== undefined) as number[];
      
      byCandidateType[candidateType!] = {
        connections: candidateMetrics.length,
        successRate: 1.0, // These are already successful connections
        averageTime: candidateTimes.length > 0 
          ? candidateTimes.reduce((sum, time) => sum + time, 0) / candidateTimes.length 
          : 0
      };
    });
    
    // Recent performance (last 24 hours)
    const recentSuccessful = recentMetrics.filter(m => m.success);
    const recentTimes = recentSuccessful
      .map(m => m.totalConnectionTime)
      .filter(t => t !== undefined) as number[];
    
    const last24Hours_stats = {
      connections: recentMetrics.length,
      successRate: recentMetrics.length > 0 ? recentSuccessful.length / recentMetrics.length : 0,
      averageTime: recentTimes.length > 0 
        ? recentTimes.reduce((sum, time) => sum + time, 0) / recentTimes.length 
        : 0
    };
    
    // Alert statistics
    const alertsByType: { [key: string]: number } = {};
    const alertsBySeverity: { [key: string]: number } = {};
    
    this.alerts.forEach(alert => {
      alertsByType[alert.type] = (alertsByType[alert.type] || 0) + 1;
      alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] || 0) + 1;
    });
    
    return {
      totalConnections,
      successfulConnections: successfulConnections.length,
      successRate,
      averageConnectionTime,
      medianConnectionTime,
      percentile95ConnectionTime,
      connectionsUnder5Seconds,
      targetSuccessRate,
      byNetworkType,
      byCandidateType,
      last24Hours: last24Hours_stats,
      alerts: {
        total: this.alerts.length,
        byType: alertsByType,
        bySeverity: alertsBySeverity
      }
    };
  }
  
  /**
   * Get recent performance alerts
   * Requirements: 10.4 - Performance alerts access
   */
  getRecentAlerts(limit: number = 10): PerformanceAlert[] {
    return this.alerts
      .slice(-limit)
      .reverse(); // Most recent first
  }
  
  /**
   * Get network adaptation recommendations
   * Requirements: 10.3 - Network type classification and adaptation
   */
  getNetworkAdaptationRecommendations(): {
    currentNetwork: NetworkClassification;
    recommendations: string[];
    configurationSuggestions: {
      iceTransportPolicy: 'all' | 'relay';
      iceCandidatePoolSize: number;
      turnFallbackTimeout: number;
      iceGatheringTimeout: number;
    };
  } {
    const currentNetwork = this.classifyNetwork();
    const recommendations: string[] = [];
    
    // Base recommendations on network type
    if (currentNetwork.type === 'mobile') {
      recommendations.push('Use TURN-first strategy for mobile networks');
      recommendations.push('Prefer relay candidates to avoid CGNAT issues');
      recommendations.push('Use aggressive timeout control (3-5 seconds)');
      recommendations.push('Minimize ICE candidate pool size for faster gathering');
    } else if (currentNetwork.type === 'wifi') {
      recommendations.push('Use parallel STUN/TURN gathering for WiFi networks');
      recommendations.push('Allow all transport types with TURN priority');
      recommendations.push('Use moderate timeout control (5-8 seconds)');
      recommendations.push('Optimize ICE candidate pool for reliability');
    } else {
      recommendations.push('Use conservative TURN-first strategy for unknown networks');
      recommendations.push('Assume restrictive network conditions');
      recommendations.push('Use aggressive timeout control as fallback');
    }
    
    // Add performance-based recommendations
    const stats = this.getPerformanceStats();
    if (stats.targetSuccessRate < this.TARGET_SUCCESS_RATE) {
      recommendations.push('Performance below target - consider more aggressive TURN usage');
      recommendations.push('Review ICE server configuration and availability');
    }
    
    if (stats.averageConnectionTime > this.TARGET_CONNECTION_TIME) {
      recommendations.push('Average connection time above target - optimize timeout settings');
      recommendations.push('Consider reducing ICE gathering timeout');
    }
    
    // Configuration suggestions based on network type
    const configurationSuggestions = {
      iceTransportPolicy: currentNetwork.type === 'mobile' ? 'relay' as const : 'all' as const,
      iceCandidatePoolSize: currentNetwork.type === 'mobile' ? 4 : 6,
      turnFallbackTimeout: currentNetwork.type === 'mobile' ? 2000 : 3000,
      iceGatheringTimeout: currentNetwork.type === 'mobile' ? 4000 : 5000
    };
    
    return {
      currentNetwork,
      recommendations,
      configurationSuggestions
    };
  }
  
  /**
   * Get current active metrics (for testing and debugging)
   */
  getCurrentMetrics(): ConnectionMetrics | null {
    return this.currentMetrics;
  }
  
  /**
   * Clear metrics history (for testing or privacy)
   */
  clearMetrics(): void {
    this.metrics = [];
    this.alerts = [];
    this.currentMetrics = null;
    console.log('📊 Performance metrics cleared');
  }
  
  /**
   * Export metrics for analysis
   */
  exportMetrics(): {
    metrics: ConnectionMetrics[];
    alerts: PerformanceAlert[];
    stats: PerformanceStats;
    exportTimestamp: number;
  } {
    return {
      metrics: [...this.metrics],
      alerts: [...this.alerts],
      stats: this.getPerformanceStats(),
      exportTimestamp: Date.now()
    };
  }
}

// Global instance for application use
export const performanceMetricsCollector = new PerformanceMetricsCollector();

/**
 * Convenience functions for easy integration
 */

/**
 * Start connection performance timing
 * Requirements: 10.1 - Connection timing measurement
 */
export function startConnectionTiming(sessionId?: string, userId?: string, attemptNumber?: number): void {
  performanceMetricsCollector.startConnectionTiming(sessionId, userId, attemptNumber);
}

/**
 * Record a connection milestone
 * Requirements: 10.1 - Milestone timing tracking
 */
export function recordConnectionMilestone(milestone: string, additionalData?: any): void {
  performanceMetricsCollector.recordMilestone(milestone, additionalData);
}

/**
 * Record ICE candidate for tracking
 * Requirements: 10.2 - ICE candidate type tracking
 */
export function recordICECandidateMetrics(candidate: RTCIceCandidate, isSuccessful?: boolean): void {
  performanceMetricsCollector.recordICECandidate(candidate, isSuccessful);
}

/**
 * Complete connection timing
 * Requirements: 10.1, 10.4 - Complete timing and performance validation
 */
export function completeConnectionTiming(success: boolean, failureReason?: string, connectionState?: string, iceConnectionState?: string): ConnectionMetrics {
  return performanceMetricsCollector.completeConnectionTiming(success, failureReason, connectionState, iceConnectionState);
}

/**
 * Get current performance statistics
 * Requirements: 10.4, 10.5 - Performance reporting
 */
export function getPerformanceStatistics(): PerformanceStats {
  return performanceMetricsCollector.getPerformanceStats();
}

/**
 * Get network adaptation recommendations
 * Requirements: 10.3 - Network classification and adaptation
 */
export function getNetworkAdaptations(): ReturnType<typeof performanceMetricsCollector.getNetworkAdaptationRecommendations> {
  return performanceMetricsCollector.getNetworkAdaptationRecommendations();
}

/**
 * Get recent performance alerts
 * Requirements: 10.4 - Performance alerts
 */
export function getPerformanceAlerts(limit?: number): PerformanceAlert[] {
  return performanceMetricsCollector.getRecentAlerts(limit);
}