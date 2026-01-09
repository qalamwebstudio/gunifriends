/**
 * WebRTC Performance Monitoring Integration Example
 * 
 * Demonstrates how to integrate performance monitoring into existing WebRTC code.
 * This example shows the key integration points for the VideoChat component.
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 * - Integration example for existing WebRTC components
 * - Performance monitoring best practices
 * - Real-time alerting integration
 */

import {
  initializePerformanceMonitoring,
  recordPerformanceMilestone,
  getPerformanceOptimizedConfig,
  monitorConnectionQuality,
  getPerformanceReport,
  usePerformanceMonitoring,
  type PerformanceAlert,
  type PerformanceStats
} from './webrtc-performance-integration';

import { getWebRTCConfiguration, getMediaStreamWithFallback } from './webrtc-config';

/**
 * Example: Enhanced WebRTC Connection Setup with Performance Monitoring
 * 
 * This example shows how to integrate performance monitoring into the existing
 * VideoChat component's connection establishment flow.
 */
export class PerformanceMonitoredWebRTCConnection {
  private sessionId: string;
  private userId?: string;
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private performanceCallbacks: {
    onAlert?: (alert: PerformanceAlert) => void;
    onStatsUpdate?: (stats: PerformanceStats) => void;
  } = {};

  constructor(sessionId: string, userId?: string) {
    this.sessionId = sessionId;
    this.userId = userId;
  }

  /**
   * Set performance monitoring callbacks
   */
  setPerformanceCallbacks(callbacks: typeof this.performanceCallbacks): void {
    this.performanceCallbacks = callbacks;
  }

  /**
   * Initialize WebRTC connection with performance monitoring
   * Requirements: 10.1 - Connection timing measurement system
   */
  async initializeConnection(attemptNumber: number = 1): Promise<RTCPeerConnection> {
    console.log(`🚀 Starting WebRTC connection initialization (attempt ${attemptNumber})`);

    // Step 1: Initialize performance monitoring
    initializePerformanceMonitoring(
      this.sessionId,
      this.userId,
      attemptNumber,
      {
        onAlert: this.performanceCallbacks.onAlert,
        onStatsUpdate: this.performanceCallbacks.onStatsUpdate,
        onNetworkAdaptation: (adaptations) => {
          console.log(`📊 Network adaptations available:`, adaptations.recommendations);
        }
      }
    );

    try {
      // Step 2: Get media access (record timing)
      const mediaStream = await this.getMediaWithMonitoring();
      
      // Step 3: Create peer connection with optimized config
      const peerConnection = await this.createPeerConnectionWithMonitoring();
      
      // Step 4: Add media tracks and start ICE gathering
      await this.setupMediaTracksWithMonitoring(peerConnection, mediaStream);
      
      // Step 5: Set up connection monitoring
      this.setupConnectionMonitoring(peerConnection);
      
      console.log(`✅ WebRTC connection initialized successfully`);
      return peerConnection;

    } catch (error) {
      console.error(`❌ WebRTC connection initialization failed:`, error);
      
      // Complete monitoring with failure
      recordPerformanceMilestone.complete(
        false,
        error instanceof Error ? error.message : 'Unknown error'
      );
      
      throw error;
    }
  }

  /**
   * Get media stream with performance monitoring
   * Requirements: 10.1 - Media access timing
   */
  private async getMediaWithMonitoring(): Promise<MediaStream> {
    console.log(`📹 Requesting media access...`);
    
    try {
      const mediaStream = await getMediaStreamWithFallback();
      
      // Record media ready milestone
      recordPerformanceMilestone.mediaReady(mediaStream);
      
      this.localStream = mediaStream;
      console.log(`✅ Media access successful: ${mediaStream.getVideoTracks().length} video, ${mediaStream.getAudioTracks().length} audio tracks`);
      
      return mediaStream;
      
    } catch (error) {
      console.error(`❌ Media access failed:`, error);
      throw new Error(`Media access failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create peer connection with performance-optimized configuration
   * Requirements: 10.3 - Network-adapted configuration
   */
  private async createPeerConnectionWithMonitoring(): Promise<RTCPeerConnection> {
    console.log(`🔗 Creating peer connection with optimized configuration...`);
    
    try {
      // Get performance-optimized configuration
      const optimizedConfig = getPerformanceOptimizedConfig();
      
      // Record ICE gathering start
      recordPerformanceMilestone.iceGatheringStart(optimizedConfig);
      
      // Create peer connection
      const peerConnection = new RTCPeerConnection(optimizedConfig);
      
      // Set up ICE candidate monitoring
      peerConnection.addEventListener('icecandidate', (event) => {
        if (event.candidate) {
          recordPerformanceMilestone.iceCandidate(event.candidate);
        }
      });
      
      // Monitor connection state changes
      peerConnection.addEventListener('connectionstatechange', () => {
        console.log(`🔗 Connection state: ${peerConnection.connectionState}`);
        
        if (peerConnection.connectionState === 'connected') {
          recordPerformanceMilestone.connectionEstablished(peerConnection);
        }
      });
      
      this.peerConnection = peerConnection;
      console.log(`✅ Peer connection created with optimized configuration`);
      
      return peerConnection;
      
    } catch (error) {
      console.error(`❌ Peer connection creation failed:`, error);
      throw new Error(`Peer connection creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Setup media tracks with performance monitoring
   * Requirements: 10.1 - Track attachment timing
   */
  private async setupMediaTracksWithMonitoring(
    peerConnection: RTCPeerConnection,
    mediaStream: MediaStream
  ): Promise<void> {
    console.log(`🎵 Adding media tracks to peer connection...`);
    
    try {
      // Add all tracks to peer connection
      mediaStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, mediaStream);
      });
      
      console.log(`✅ Media tracks added successfully`);
      
    } catch (error) {
      console.error(`❌ Failed to add media tracks:`, error);
      throw new Error(`Media track setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Setup connection monitoring and quality tracking
   * Requirements: 10.4 - Connection quality monitoring
   */
  private setupConnectionMonitoring(peerConnection: RTCPeerConnection): void {
    console.log(`📊 Setting up connection monitoring...`);
    
    // Monitor for successful ICE candidate selection
    peerConnection.addEventListener('iceconnectionstatechange', () => {
      console.log(`🧊 ICE connection state: ${peerConnection.iceConnectionState}`);
      
      if (peerConnection.iceConnectionState === 'connected') {
        // Find the successful candidate pair
        peerConnection.getStats().then(stats => {
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              // This would require additional logic to map back to the original candidate
              console.log(`✅ Successful candidate pair found`);
            }
          });
        });
      }
    });
    
    // Set up periodic quality monitoring
    let qualityMonitoringInterval: NodeJS.Timeout | null = null;
    
    peerConnection.addEventListener('connectionstatechange', () => {
      if (peerConnection.connectionState === 'connected') {
        console.log(`📊 Starting connection quality monitoring...`);
        
        // Start quality monitoring
        qualityMonitoringInterval = setInterval(async () => {
          try {
            const qualityReport = await monitorConnectionQuality(peerConnection);
            
            if (qualityReport.quality === 'poor') {
              console.warn(`⚠️ Poor connection quality detected:`, qualityReport.recommendations);
            }
            
          } catch (error) {
            console.error(`❌ Quality monitoring failed:`, error);
          }
        }, 10000); // Monitor every 10 seconds
        
      } else if (peerConnection.connectionState === 'disconnected' || 
                 peerConnection.connectionState === 'failed' ||
                 peerConnection.connectionState === 'closed') {
        
        // Stop quality monitoring
        if (qualityMonitoringInterval) {
          clearInterval(qualityMonitoringInterval);
          qualityMonitoringInterval = null;
        }
      }
    });
  }

  /**
   * Handle remote video stream with performance monitoring
   * Requirements: 10.1 - First frame timing
   */
  handleRemoteStream(remoteStream: MediaStream, remoteVideoElement: HTMLVideoElement): void {
    console.log(`📺 Handling remote stream...`);
    
    // Set up first frame detection
    const handleFirstFrame = () => {
      recordPerformanceMilestone.firstRemoteFrame();
      console.log(`✅ First remote frame received`);
      
      // Remove event listener after first frame
      remoteVideoElement.removeEventListener('loadeddata', handleFirstFrame);
    };
    
    remoteVideoElement.addEventListener('loadeddata', handleFirstFrame);
    remoteVideoElement.srcObject = remoteStream;
  }

  /**
   * Complete connection with performance monitoring
   * Requirements: 10.1, 10.4 - Connection completion and validation
   */
  completeConnection(success: boolean, failureReason?: string): void {
    console.log(`🏁 Completing connection: ${success ? 'SUCCESS' : 'FAILURE'}`);
    
    const connectionState = this.peerConnection?.connectionState;
    const iceConnectionState = this.peerConnection?.iceConnectionState;
    
    // Complete performance monitoring
    const metrics = recordPerformanceMilestone.complete(
      success,
      failureReason,
      connectionState,
      iceConnectionState
    );
    
    // Log performance summary
    if (success && metrics.totalConnectionTime) {
      if (metrics.totalConnectionTime <= 5000) {
        console.log(`🎉 Connection completed successfully in ${metrics.totalConnectionTime.toFixed(2)}ms (MEETS TARGET)`);
      } else {
        console.log(`⚠️ Connection completed in ${metrics.totalConnectionTime.toFixed(2)}ms (EXCEEDS 5s TARGET)`);
      }
    }
    
    // Trigger stats update callback
    if (this.performanceCallbacks.onStatsUpdate) {
      const { getStats } = usePerformanceMonitoring();
      this.performanceCallbacks.onStatsUpdate(getStats());
    }
  }

  /**
   * Handle TURN fallback with performance monitoring
   * Requirements: 10.1, 10.2 - TURN fallback tracking
   */
  handleTURNFallback(reason: string): void {
    console.log(`🔄 TURN fallback triggered: ${reason}`);
    recordPerformanceMilestone.turnFallback(reason);
  }

  /**
   * Get current performance report
   * Requirements: 10.5 - Performance reporting
   */
  getPerformanceReport(): ReturnType<typeof getPerformanceReport> {
    return getPerformanceReport();
  }

  /**
   * Cleanup connection and monitoring
   */
  cleanup(): void {
    console.log(`🧹 Cleaning up WebRTC connection and monitoring...`);
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
    
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}

/**
 * Example usage in React component
 */
export const usePerformanceMonitoredWebRTC = (sessionId: string, userId?: string) => {
  const connection = new PerformanceMonitoredWebRTCConnection(sessionId, userId);
  
  return {
    initializeConnection: (attemptNumber?: number) => connection.initializeConnection(attemptNumber),
    handleRemoteStream: (stream: MediaStream, videoElement: HTMLVideoElement) => 
      connection.handleRemoteStream(stream, videoElement),
    completeConnection: (success: boolean, failureReason?: string) => 
      connection.completeConnection(success, failureReason),
    handleTURNFallback: (reason: string) => connection.handleTURNFallback(reason),
    getPerformanceReport: () => connection.getPerformanceReport(),
    cleanup: () => connection.cleanup(),
    setPerformanceCallbacks: (callbacks: Parameters<typeof connection.setPerformanceCallbacks>[0]) =>
      connection.setPerformanceCallbacks(callbacks)
  };
};

/**
 * Integration points for existing VideoChat component
 */
export const VideoChat_PerformanceIntegration = {
  /**
   * Call this at the start of connection establishment
   */
  startConnection: (sessionId: string, userId?: string, attemptNumber?: number) => {
    initializePerformanceMonitoring(sessionId, userId, attemptNumber);
  },

  /**
   * Call this when media access is successful
   */
  mediaReady: (mediaStream: MediaStream) => {
    recordPerformanceMilestone.mediaReady(mediaStream);
  },

  /**
   * Call this when ICE gathering starts
   */
  iceGatheringStart: (config: RTCConfiguration) => {
    recordPerformanceMilestone.iceGatheringStart(config);
  },

  /**
   * Call this for each ICE candidate
   */
  iceCandidate: (candidate: RTCIceCandidate, isSuccessful?: boolean) => {
    recordPerformanceMilestone.iceCandidate(candidate, isSuccessful);
  },

  /**
   * Call this when TURN fallback is triggered
   */
  turnFallback: (reason: string) => {
    recordPerformanceMilestone.turnFallback(reason);
  },

  /**
   * Call this when connection is established
   */
  connectionEstablished: (peerConnection: RTCPeerConnection) => {
    recordPerformanceMilestone.connectionEstablished(peerConnection);
  },

  /**
   * Call this when first remote frame is received
   */
  firstRemoteFrame: () => {
    recordPerformanceMilestone.firstRemoteFrame();
  },

  /**
   * Call this when connection is complete (success or failure)
   */
  completeConnection: (success: boolean, failureReason?: string, connectionState?: string, iceConnectionState?: string) => {
    return recordPerformanceMilestone.complete(success, failureReason, connectionState, iceConnectionState);
  },

  /**
   * Get performance-optimized WebRTC configuration
   */
  getOptimizedConfig: () => {
    return getPerformanceOptimizedConfig();
  },

  /**
   * Monitor connection quality during established connection
   */
  monitorQuality: (peerConnection: RTCPeerConnection) => {
    return monitorConnectionQuality(peerConnection);
  },

  /**
   * Get comprehensive performance report
   */
  getReport: () => {
    return getPerformanceReport();
  }
};

/**
 * Example alert handler for React components
 */
export const createPerformanceAlertHandler = (
  onAlert?: (alert: PerformanceAlert) => void,
  onStatsUpdate?: (stats: PerformanceStats) => void
) => {
  return {
    onAlert: (alert: PerformanceAlert) => {
      console.log(`📊 Performance Alert [${alert.severity}]: ${alert.message}`);
      
      // Show user-friendly notifications for critical issues
      if (alert.severity === 'critical') {
        console.error(`🚨 Critical performance issue: ${alert.message}`);
      }
      
      if (onAlert) {
        onAlert(alert);
      }
    },
    
    onStatsUpdate: (stats: PerformanceStats) => {
      console.log(`📊 Performance Stats Update: ${stats.totalConnections} connections, ${(stats.successRate * 100).toFixed(1)}% success rate`);
      
      if (onStatsUpdate) {
        onStatsUpdate(stats);
      }
    }
  };
};