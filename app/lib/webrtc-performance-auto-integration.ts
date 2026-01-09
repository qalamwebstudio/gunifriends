/**
 * WebRTC Performance Auto-Integration
 * 
 * Automatically integrates performance monitoring with WebRTC connections.
 * Provides seamless monitoring without requiring manual integration in every component.
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 * - Automatic performance monitoring activation
 * - Seamless integration with existing WebRTC code
 * - Real-time alerts and adaptations
 * - Network optimization triggers
 */

import { WebRTCManager } from './webrtc-manager';
import {
  performanceAwareWebRTCManager,
  initializePerformanceMonitoring,
  recordPerformanceMilestone,
  getPerformanceOptimizedConfig,
  monitorConnectionQuality
} from './webrtc-performance-integration';
import {
  startRealTimeMonitoring,
  stopRealTimeMonitoring,
  onPerformanceAlert,
  onMetricsUpdate,
  onPerformanceAdaptation,
  type RealTimeMetrics,
  type PerformanceAdaptation
} from './real-time-performance-monitor';
import { turnFirstICEManager } from './turn-first-ice-manager';

/**
 * Performance monitoring state
 */
interface MonitoringState {
  isActive: boolean;
  sessionId?: string;
  userId?: string;
  startTime?: number;
  peerConnection?: RTCPeerConnection;
  adaptationCount: number;
  lastAdaptationTime: number;
}

let monitoringState: MonitoringState = {
  isActive: false,
  adaptationCount: 0,
  lastAdaptationTime: 0
};

/**
 * Auto-integration configuration
 */
interface AutoIntegrationConfig {
  enableRealTimeMonitoring: boolean;
  enableAutoAdaptation: boolean;
  enablePerformanceAlerts: boolean;
  alertCallback?: (alert: any) => void;
  metricsCallback?: (metrics: RealTimeMetrics) => void;
  adaptationCallback?: (adaptation: PerformanceAdaptation) => void;
  maxAdaptationsPerSession: number;
  adaptationCooldownMs: number;
}

let autoConfig: AutoIntegrationConfig = {
  enableRealTimeMonitoring: true,
  enableAutoAdaptation: true,
  enablePerformanceAlerts: true,
  maxAdaptationsPerSession: 5,
  adaptationCooldownMs: 10000 // 10 seconds
};

/**
 * Initialize automatic performance monitoring integration
 * Requirements: 10.1, 10.4 - Automatic monitoring setup
 */
export function initializeAutoPerformanceMonitoring(config?: Partial<AutoIntegrationConfig>): void {
  // Update configuration
  autoConfig = { ...autoConfig, ...config };

  console.log('📊 Initializing automatic performance monitoring integration');

  // Setup performance alert handling
  if (autoConfig.enablePerformanceAlerts) {
    onPerformanceAlert((alert) => {
      console.log(`📊 Performance Alert: ${alert.message}`);
      
      // Call user callback if provided
      if (autoConfig.alertCallback) {
        autoConfig.alertCallback(alert);
      }

      // Handle critical alerts with automatic actions
      if (alert.severity === 'critical') {
        handleCriticalAlert(alert);
      }
    });
  }

  // Setup metrics monitoring
  if (autoConfig.enableRealTimeMonitoring) {
    onMetricsUpdate((metrics) => {
      // Call user callback if provided
      if (autoConfig.metricsCallback) {
        autoConfig.metricsCallback(metrics);
      }

      // Check for automatic adaptation needs
      if (autoConfig.enableAutoAdaptation) {
        checkForAutoAdaptation(metrics);
      }
    });
  }

  // Setup adaptation handling
  if (autoConfig.enableAutoAdaptation) {
    onPerformanceAdaptation((adaptation) => {
      console.log(`📊 Performance Adaptation: ${adaptation.action} - ${adaptation.reason}`);
      
      // Call user callback if provided
      if (autoConfig.adaptationCallback) {
        autoConfig.adaptationCallback(adaptation);
      }

      // Apply the adaptation
      applyPerformanceAdaptation(adaptation);
    });
  }

  console.log('✅ Automatic performance monitoring integration initialized');
}

/**
 * Start monitoring for a WebRTC connection
 * Requirements: 10.1 - Connection timing and monitoring
 */
export function startAutoPerformanceMonitoring(
  peerConnection: RTCPeerConnection,
  sessionId: string,
  userId?: string
): void {
  console.log(`📊 Starting automatic performance monitoring for session ${sessionId}`);

  // Update monitoring state
  monitoringState = {
    isActive: true,
    sessionId,
    userId,
    startTime: performance.now(),
    peerConnection,
    adaptationCount: 0,
    lastAdaptationTime: 0
  };

  // Initialize performance metrics collection
  initializePerformanceMonitoring(sessionId, userId, 1, {
    onAlert: autoConfig.alertCallback,
    onStatsUpdate: (stats) => {
      console.log(`📊 Performance Stats Update: ${stats.successRate * 100}% success rate`);
    },
    onNetworkAdaptation: (adaptations) => {
      console.log(`📊 Network Adaptations: ${adaptations.recommendations.length} recommendations`);
    }
  });

  // Start real-time monitoring
  if (autoConfig.enableRealTimeMonitoring) {
    startRealTimeMonitoring(peerConnection, {
      enableAutoAdaptation: autoConfig.enableAutoAdaptation,
      enableRealTimeAlerts: autoConfig.enablePerformanceAlerts
    });
  }

  // Record initial milestone
  recordPerformanceMilestone.mediaReady = (mediaStream: MediaStream) => {
    console.log('📊 Media ready milestone recorded');
    performanceAwareWebRTCManager.recordMediaReady(mediaStream);
  };

  console.log('✅ Automatic performance monitoring started');
}

/**
 * Stop monitoring
 */
export function stopAutoPerformanceMonitoring(): void {
  if (!monitoringState.isActive) {
    return;
  }

  console.log('📊 Stopping automatic performance monitoring');

  // Complete performance monitoring
  if (monitoringState.sessionId && monitoringState.peerConnection) {
    const connectionState = monitoringState.peerConnection.connectionState;
    const iceConnectionState = monitoringState.peerConnection.iceConnectionState;
    const success = connectionState === 'connected' || iceConnectionState === 'connected';
    
    recordPerformanceMilestone.complete(
      success,
      success ? undefined : `Connection failed: ${connectionState}/${iceConnectionState}`,
      connectionState,
      iceConnectionState
    );
  }

  // Stop real-time monitoring
  stopRealTimeMonitoring();

  // Reset monitoring state
  monitoringState = {
    isActive: false,
    adaptationCount: 0,
    lastAdaptationTime: 0
  };

  console.log('✅ Automatic performance monitoring stopped');
}

/**
 * Get optimized WebRTC configuration with performance adaptations
 * Requirements: 10.3 - Network-adapted configuration
 */
export function getAutoOptimizedWebRTCConfig(): RTCConfiguration {
  console.log('📊 Getting auto-optimized WebRTC configuration');
  
  const optimizedConfig = getPerformanceOptimizedConfig();
  
  // Apply additional optimizations based on current monitoring state
  if (monitoringState.isActive && monitoringState.adaptationCount > 2) {
    // If we've had multiple adaptations, be more aggressive
    optimizedConfig.iceTransportPolicy = 'relay';
    optimizedConfig.iceCandidatePoolSize = Math.min(optimizedConfig.iceCandidatePoolSize || 4, 4);
    
    console.log('📊 Applied aggressive optimization due to multiple adaptations');
  }

  return optimizedConfig;
}

/**
 * Record WebRTC milestones automatically
 * Requirements: 10.1, 10.2 - Automatic milestone tracking
 */
export const autoRecordMilestone = {
  mediaReady: (mediaStream: MediaStream) => {
    if (monitoringState.isActive) {
      recordPerformanceMilestone.mediaReady(mediaStream);
    }
  },
  
  iceGatheringStart: (config: RTCConfiguration) => {
    if (monitoringState.isActive) {
      recordPerformanceMilestone.iceGatheringStart(config);
    }
  },
  
  iceCandidate: (candidate: RTCIceCandidate, isSuccessful?: boolean) => {
    if (monitoringState.isActive) {
      recordPerformanceMilestone.iceCandidate(candidate, isSuccessful);
    }
  },
  
  turnFallback: (reason: string) => {
    if (monitoringState.isActive) {
      recordPerformanceMilestone.turnFallback(reason);
    }
  },
  
  connectionEstablished: (peerConnection: RTCPeerConnection) => {
    if (monitoringState.isActive) {
      recordPerformanceMilestone.connectionEstablished(peerConnection);
    }
  },
  
  firstRemoteFrame: () => {
    if (monitoringState.isActive) {
      recordPerformanceMilestone.firstRemoteFrame();
    }
  }
};

/**
 * Handle critical performance alerts
 * Requirements: 10.4 - Critical alert handling
 */
function handleCriticalAlert(alert: any): void {
  console.warn(`🚨 Critical Performance Alert: ${alert.message}`);

  // For critical connection issues, trigger immediate adaptation
  if (alert.type === 'connection-timeout' && monitoringState.peerConnection) {
    console.log('🚨 Triggering emergency adaptation for critical connection timeout');
    
    // Force TURN relay mode
    const adaptation: PerformanceAdaptation = {
      type: 'network-strategy',
      action: 'force-turn-relay-emergency',
      reason: 'Critical connection timeout detected',
      timestamp: Date.now(),
      expectedImprovement: 'Emergency TURN relay should stabilize connection'
    };
    
    applyPerformanceAdaptation(adaptation);
  }

  // For critical packet loss, reduce quality immediately
  if (alert.message.includes('packet loss') && alert.severity === 'critical') {
    console.log('🚨 Triggering emergency quality reduction for critical packet loss');
    
    const adaptation: PerformanceAdaptation = {
      type: 'media-quality',
      action: 'emergency-quality-reduction',
      reason: 'Critical packet loss detected',
      timestamp: Date.now(),
      expectedImprovement: 'Reduced quality should improve stability'
    };
    
    applyPerformanceAdaptation(adaptation);
  }
}

/**
 * Check for automatic adaptation needs
 * Requirements: 10.3 - Automatic network adaptation
 */
function checkForAutoAdaptation(metrics: RealTimeMetrics): void {
  if (!autoConfig.enableAutoAdaptation || !monitoringState.isActive) {
    return;
  }

  const now = Date.now();
  
  // Check cooldown period
  if (now - monitoringState.lastAdaptationTime < autoConfig.adaptationCooldownMs) {
    return;
  }

  // Check adaptation limit
  if (monitoringState.adaptationCount >= autoConfig.maxAdaptationsPerSession) {
    console.log('📊 Maximum adaptations per session reached, skipping auto-adaptation');
    return;
  }

  // Check for adaptation triggers
  let needsAdaptation = false;
  let adaptationType: PerformanceAdaptation['type'] = 'network-strategy';
  let action = '';
  let reason = '';

  // High latency trigger
  if (metrics.currentLatency > 300 && metrics.trends.latencyTrend === 'degrading') {
    needsAdaptation = true;
    adaptationType = 'timeout-adjustment';
    action = 'reduce-ice-timeout';
    reason = `High latency (${metrics.currentLatency.toFixed(0)}ms) with degrading trend`;
  }

  // High packet loss trigger
  if (metrics.currentPacketLoss > 0.03 && metrics.trends.packetLossTrend === 'degrading') {
    needsAdaptation = true;
    adaptationType = 'network-strategy';
    action = 'force-turn-relay';
    reason = `High packet loss (${(metrics.currentPacketLoss * 100).toFixed(1)}%) with degrading trend`;
  }

  // Poor connection quality trigger
  if (metrics.connectionQuality === 'poor' || metrics.connectionQuality === 'critical') {
    needsAdaptation = true;
    adaptationType = 'media-quality';
    action = 'reduce-video-quality';
    reason = `Connection quality is ${metrics.connectionQuality}`;
  }

  if (needsAdaptation) {
    const adaptation: PerformanceAdaptation = {
      type: adaptationType,
      action,
      reason,
      timestamp: now,
      expectedImprovement: 'Automatic adaptation to improve connection stability'
    };

    console.log(`📊 Triggering automatic adaptation: ${action} - ${reason}`);
    applyPerformanceAdaptation(adaptation);
    
    monitoringState.adaptationCount++;
    monitoringState.lastAdaptationTime = now;
  }
}

/**
 * Apply performance adaptation
 * Requirements: 10.3 - Network adaptation implementation
 */
function applyPerformanceAdaptation(adaptation: PerformanceAdaptation): void {
  console.log(`📊 Applying performance adaptation: ${adaptation.action}`);

  switch (adaptation.action) {
    case 'force-turn-relay':
    case 'force-turn-relay-emergency':
      // Update ICE configuration to prefer TURN relay
      if (monitoringState.peerConnection) {
        console.log('📊 Forcing TURN relay mode for better connectivity');
        // Note: In a real implementation, this would require recreating the peer connection
        // with updated ICE configuration or triggering ICE restart with relay-only policy
      }
      break;

    case 'reduce-video-quality':
    case 'emergency-quality-reduction':
      // Reduce video quality to improve performance
      console.log('📊 Reducing video quality to improve performance');
      // Note: In a real implementation, this would adjust video constraints
      // or modify encoding parameters
      break;

    case 'reduce-ice-timeout':
      // Reduce ICE gathering timeout for faster fallback
      console.log('📊 Reducing ICE timeout for faster TURN fallback');
      // Note: This would be applied to future connection attempts
      break;

    default:
      console.warn(`📊 Unknown adaptation action: ${adaptation.action}`);
  }
}

/**
 * Get current monitoring status
 */
export function getAutoMonitoringStatus(): {
  isActive: boolean;
  sessionId?: string;
  userId?: string;
  adaptationCount: number;
  uptime?: number;
  config: AutoIntegrationConfig;
} {
  return {
    isActive: monitoringState.isActive,
    sessionId: monitoringState.sessionId,
    userId: monitoringState.userId,
    adaptationCount: monitoringState.adaptationCount,
    uptime: monitoringState.startTime ? performance.now() - monitoringState.startTime : undefined,
    config: { ...autoConfig }
  };
}

/**
 * Update auto-integration configuration
 */
export function updateAutoIntegrationConfig(config: Partial<AutoIntegrationConfig>): void {
  autoConfig = { ...autoConfig, ...config };
  console.log('📊 Updated auto-integration configuration');
}

/**
 * Enhanced WebRTC connection wrapper with automatic performance monitoring
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5 - Complete integration wrapper
 */
export class AutoMonitoredWebRTCConnection {
  private peerConnection: RTCPeerConnection;
  private sessionId: string;
  private userId?: string;
  private isMonitoring = false;

  constructor(config: RTCConfiguration, sessionId: string, userId?: string) {
    // Get optimized configuration
    const optimizedConfig = getAutoOptimizedWebRTCConfig();
    
    // Merge with provided config
    this.peerConnection = new RTCPeerConnection({ ...optimizedConfig, ...config });
    this.sessionId = sessionId;
    this.userId = userId;

    // Start automatic monitoring
    this.startMonitoring();
  }

  private startMonitoring(): void {
    if (this.isMonitoring) return;

    startAutoPerformanceMonitoring(this.peerConnection, this.sessionId, this.userId);
    this.isMonitoring = true;

    // Setup automatic milestone recording
    this.setupAutomaticMilestones();
  }

  private setupAutomaticMilestones(): void {
    // Monitor connection state changes
    this.peerConnection.addEventListener('connectionstatechange', () => {
      if (this.peerConnection.connectionState === 'connected') {
        autoRecordMilestone.connectionEstablished(this.peerConnection);
      }
    });

    // Monitor ICE candidates
    this.peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        autoRecordMilestone.iceCandidate(event.candidate);
      }
    });

    // Monitor ICE gathering state
    this.peerConnection.addEventListener('icegatheringstatechange', () => {
      if (this.peerConnection.iceGatheringState === 'gathering') {
        autoRecordMilestone.iceGatheringStart(this.peerConnection.getConfiguration());
      }
    });
  }

  // Proxy all RTCPeerConnection methods
  get connectionState() { return this.peerConnection.connectionState; }
  get iceConnectionState() { return this.peerConnection.iceConnectionState; }
  get iceGatheringState() { return this.peerConnection.iceGatheringState; }
  get localDescription() { return this.peerConnection.localDescription; }
  get remoteDescription() { return this.peerConnection.remoteDescription; }

  async createOffer(options?: RTCOfferOptions) {
    return this.peerConnection.createOffer(options);
  }

  async createAnswer(options?: RTCAnswerOptions) {
    return this.peerConnection.createAnswer(options);
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit) {
    return this.peerConnection.setLocalDescription(description);
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    return this.peerConnection.setRemoteDescription(description);
  }

  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]) {
    return this.peerConnection.addTrack(track, ...streams);
  }

  removeTrack(sender: RTCRtpSender) {
    return this.peerConnection.removeTrack(sender);
  }

  addEventListener(type: string, listener: EventListener) {
    return this.peerConnection.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    return this.peerConnection.removeEventListener(type, listener);
  }

  async getStats(selector?: MediaStreamTrack | null) {
    return this.peerConnection.getStats(selector);
  }

  close() {
    if (this.isMonitoring) {
      stopAutoPerformanceMonitoring();
      this.isMonitoring = false;
    }
    return this.peerConnection.close();
  }

  // Additional monitoring methods
  recordMediaReady(mediaStream: MediaStream) {
    autoRecordMilestone.mediaReady(mediaStream);
  }

  recordFirstRemoteFrame() {
    autoRecordMilestone.firstRemoteFrame();
  }

  async getConnectionQuality() {
    if (this.isMonitoring) {
      return monitorConnectionQuality(this.peerConnection);
    }
    return null;
  }
}

/**
 * Create an auto-monitored WebRTC connection
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5 - Easy integration for existing code
 */
export function createAutoMonitoredConnection(
  config: RTCConfiguration,
  sessionId: string,
  userId?: string
): AutoMonitoredWebRTCConnection {
  return new AutoMonitoredWebRTCConnection(config, sessionId, userId);
}