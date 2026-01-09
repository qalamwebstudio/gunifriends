/**
 * WebRTC Configuration and Utilities
 * Enhanced with proper TURN server support and network traversal
 * Fixes 40-50 second connection drops in restrictive networks
 */

import { 
  getNetworkTraversalConfig, 
  detectNetworkEnvironment,
  NetworkTraversalMonitor,
  performICERestart
} from './webrtc-network-traversal';
import { testAllTURNServers, quickTURNCheck } from './turn-test';

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: 'all' | 'relay';
  iceCandidatePoolSize?: number;
  bundlePolicy?: RTCBundlePolicy;
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
}

/**
 * Get WebRTC configuration optimized for TURN-first strategy and aggressive timeouts
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5 - TURN-first ICE configuration with parallel gathering
 */
export async function getWebRTCConfiguration(forceRelay: boolean = false, networkType: 'mobile' | 'wifi' | 'unknown' = 'unknown'): Promise<WebRTCConfig> {
  try {
    // Import the TURN-first ICE manager
    const { turnFirstICEManager, validateTurnServerSetup } = await import('./turn-first-ice-manager');
    
    // Validate TURN server setup first
    const validation = await validateTurnServerSetup();
    
    if (validation.workingServers === 0 && forceRelay) {
      console.error('❌ No working TURN servers found but relay mode requested!');
      console.error('This will cause immediate connection failure.');
      throw new Error('Relay mode requested but no TURN servers available');
    }
    
    // Generate TURN-first optimized configuration (Requirements 1.1, 1.2, 1.3)
    const optimizedConfig = turnFirstICEManager.generateOptimizedConfig(networkType);
    
    // Convert to WebRTCConfig format with TURN-first optimizations
    const config: WebRTCConfig = {
      iceServers: optimizedConfig.iceServers,
      iceTransportPolicy: optimizedConfig.iceTransportPolicy,
      iceCandidatePoolSize: optimizedConfig.iceCandidatePoolSize,
      bundlePolicy: optimizedConfig.bundlePolicy as RTCBundlePolicy,
      rtcpMuxPolicy: optimizedConfig.rtcpMuxPolicy as RTCRtcpMuxPolicy
    };
    
    // Apply network-specific optimizations (Requirements 1.4, 1.5)
    if (networkType === 'mobile') {
      // Mobile networks benefit from relay-first strategy
      config.iceTransportPolicy = 'all'; // Allow both but prioritize TURN
      config.iceCandidatePoolSize = 6; // Larger pool for mobile networks
    } else if (networkType === 'wifi') {
      // College Wi-Fi often requires TURN for traversal
      config.iceTransportPolicy = 'all'; // Allow both STUN and TURN
      config.iceCandidatePoolSize = 4; // Standard pool size
    }
    
    // Override transport policy if forcing relay (Requirements 1.4)
    if (forceRelay) {
      config.iceTransportPolicy = 'relay';
      console.log('🔒 FORCED RELAY MODE: Only TURN servers will be used');
    }
    
    console.log(`🌐 TURN-first WebRTC configuration loaded: ${config.iceServers.length} ICE servers`);
    console.log(`🔧 ICE transport policy: ${config.iceTransportPolicy} (network: ${networkType})`);
    console.log(`📊 ICE candidate pool size: ${config.iceCandidatePoolSize}`);
    
    // Validate TURN server configuration (Requirements 1.1, 1.2)
    const turnServers = config.iceServers.filter(server => 
      (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('turn')) : server.urls.startsWith('turn'))
    );
    
    if (turnServers.length > 0) {
      console.log(`✅ ${turnServers.length} TURN servers configured for NAT traversal`);
      
      // Verify both UDP and TCP TURN servers are available (Requirements 1.1)
      const udpTurnServers = turnServers.filter(server => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some(url => url.includes('turn:') && !url.includes('?transport=tcp'));
      });
      
      const tcpTurnServers = turnServers.filter(server => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return urls.some(url => url.includes('?transport=tcp'));
      });
      
      console.log(`   UDP TURN servers: ${udpTurnServers.length}`);
      console.log(`   TCP TURN servers: ${tcpTurnServers.length}`);
      
      if (udpTurnServers.length === 0) {
        console.warn('⚠️ No UDP TURN servers configured - may impact performance');
      }
      if (tcpTurnServers.length === 0) {
        console.warn('⚠️ No TCP TURN servers configured - may fail in restrictive networks');
      }
      
      // Log individual TURN servers for debugging
      turnServers.forEach((server, index) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        const firstUrl = urls[0];
        console.log(`   TURN ${index + 1}: ${firstUrl} (${server.username ? 'authenticated' : 'no auth'})`);
      });
    } else {
      console.warn('⚠️ No TURN servers configured - may fail in restrictive networks');
    }
    
    // Log validation results
    if (validation.recommendations.length > 0) {
      console.warn('⚠️ TURN server recommendations:');
      validation.recommendations.forEach(rec => console.warn(`   - ${rec}`));
    }
    
    return config;
  } catch (error) {
    console.error('❌ Failed to get TURN-first WebRTC configuration:', error);
    
    // Fallback to optimized configuration without TURN-first manager
    console.log('🔄 Falling back to optimized configuration without TURN-first manager...');
    
    try {
      // Create optimized fallback configuration with TURN-first principles
      const fallbackConfig: WebRTCConfig = {
        iceServers: [
          // STUN servers for reflexive candidates
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          // Add TURN servers if available from environment
          ...(process.env.TURN_SERVER_URL ? [{
            urls: process.env.TURN_SERVER_URL,
            username: process.env.TURN_USERNAME || '',
            credential: process.env.TURN_PASSWORD || ''
          }] : [])
        ],
        iceTransportPolicy: forceRelay ? 'relay' : 'all',
        iceCandidatePoolSize: networkType === 'mobile' ? 6 : 4, // Optimized pool size
        bundlePolicy: 'max-bundle' as RTCBundlePolicy,
        rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy
      };
      
      console.log('✅ Optimized fallback configuration loaded successfully');
      return fallbackConfig;
    } catch (legacyError) {
      console.error('❌ Optimized fallback configuration also failed:', legacyError);
      
      // Final fallback configuration with basic STUN servers
      const basicFallbackConfig: WebRTCConfig = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.services.mozilla.com' }
        ],
        iceTransportPolicy: forceRelay ? 'relay' : 'all',
        iceCandidatePoolSize: 4,
        bundlePolicy: 'max-bundle' as RTCBundlePolicy,
        rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy
      };
      
      console.log('🔄 Using basic fallback STUN-only configuration');
      return basicFallbackConfig;
    }
  }
}

/**
 * Media constraints for different quality levels
 */
export const MediaConstraints = {
  high: {
    video: {
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 60 },
      facingMode: 'user'
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000
    }
  },
  medium: {
    video: {
      width: { ideal: 640, max: 1280 },
      height: { ideal: 480, max: 720 },
      frameRate: { ideal: 24, max: 30 },
      facingMode: 'user'
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  },
  low: {
    video: {
      width: { ideal: 320, max: 640 },
      height: { ideal: 240, max: 480 },
      frameRate: { ideal: 15, max: 24 },
      facingMode: 'user'
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true
    }
  },
  audioOnly: {
    video: false,
    audio: {
      echoCancellation: true,
      noiseSuppression: true
    }
  }
} as const;

/**
 * REMOVED: Network connectivity testing (Requirements 4.1, 4.2, 4.3, 4.4, 4.5)
 * Pre-connection quality checks and bandwidth tests eliminated
 * Connection now starts immediately after media readiness using TURN-first strategy
 */
export async function testWebRTCConnectivity(): Promise<{
  hasInternet: boolean;
  hasSTUN: boolean;
  hasTURN: boolean;
  latency: number;
  networkType: 'open' | 'moderate' | 'restrictive';
  recommendedPolicy: 'all' | 'relay';
}> {
  console.log('⏭️ REMOVED: WebRTC connectivity testing disabled');
  console.log('🚀 Connection will use TURN-first ICE strategy without pre-connection probing');
  
  // Return safe default connectivity result immediately - no network probing
  return {
    hasInternet: true,
    hasSTUN: true,
    hasTURN: true,
    latency: 0,
    networkType: 'open',
    recommendedPolicy: 'all'
  };
}

/**
 * REMOVED: STUN connectivity testing (Requirements 4.1, 4.3, 4.4, 4.5)
 * Redundant STUN discovery calls beyond ICE gathering eliminated
 * Connection relies on TURN-first ICE strategy instead of pre-connection STUN probing
 */
async function testSTUNConnectivity(): Promise<boolean> {
  console.log('⏭️ REMOVED: STUN connectivity testing disabled');
  console.log('🔄 ICE gathering will handle STUN discovery during connection establishment');
  
  // Always return true - STUN testing will happen during ICE gathering
  return true;
}

// Export the enhanced network traversal components and TURN testing
export { 
  NetworkTraversalMonitor, 
  performICERestart, 
  detectNetworkEnvironment 
} from './webrtc-network-traversal';

export { 
  testAllTURNServers, 
  quickTURNCheck,
  testTURNServer 
} from './turn-test';

/**
 * Get media stream with fallback options
 */
export async function getMediaStreamWithFallback(): Promise<MediaStream> {
  const configurations = [
    MediaConstraints.high,
    MediaConstraints.medium,
    MediaConstraints.low,
    // Add more aggressive fallbacks
    {
      video: {
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 10 }
      },
      audio: true
    },
    {
      video: true,
      audio: true
    },
    MediaConstraints.audioOnly
  ];

  let lastError: Error | null = null;

  for (let i = 0; i < configurations.length; i++) {
    try {
      console.log(`Attempting media configuration ${i + 1}/${configurations.length}`);
      
      // Add timeout to prevent hanging
      const mediaPromise = navigator.mediaDevices.getUserMedia(configurations[i]);
      const timeoutPromise = new Promise<never>((_, reject) => {
        // Import registerTimeout to use the blocking mechanism
        import('./webrtc-manager').then(({ registerTimeout }) => {
          const timeoutHandle = registerTimeout(() => reject(new Error('Media access timeout')), 10000, `Media access timeout (config ${i + 1})`);
          if (!timeoutHandle) {
            // If timeout is blocked, don't reject - let the media promise resolve naturally
            console.log('⏭️ Media access timeout blocked - connection already established');
          }
        }).catch(() => {
          // Fallback if import fails - use direct setTimeout for media access
          // This is acceptable since media access happens before connection establishment
          setTimeout(() => reject(new Error('Media access timeout')), 10000);
        });
      });
      
      const stream = await Promise.race([mediaPromise, timeoutPromise]);
      
      if (i > 0) {
        console.log(`Successfully obtained media with fallback configuration ${i + 1}`);
      }
      
      // Verify stream has active tracks
      const videoTracks = stream.getVideoTracks();
      const audioTracks = stream.getAudioTracks();
      
      if (videoTracks.length === 0 && audioTracks.length === 0) {
        throw new Error('No active media tracks');
      }
      
      console.log(`Media stream obtained: ${videoTracks.length} video tracks, ${audioTracks.length} audio tracks`);
      return stream;
    } catch (error) {
      console.error(`Media configuration ${i + 1} failed:`, error);
      lastError = error as Error;
      
      // If this is a permission error, don't try other configurations
      if (error instanceof Error && error.name === 'NotAllowedError') {
        break;
      }
      
      // Add small delay between attempts
      if (i < configurations.length - 1) {
        await new Promise(resolve => {
          // Import registerTimeout to use the blocking mechanism
          import('./webrtc-manager').then(({ registerTimeout }) => {
            const delayTimeout = registerTimeout(() => resolve(undefined), 500, `Media configuration retry delay (attempt ${i + 1})`);
            if (!delayTimeout) {
              // If timeout is blocked, resolve immediately
              resolve(undefined);
            }
          }).catch(() => {
            // Fallback if import fails - use direct setTimeout for retry delay
            // This is acceptable since retry delays happen before connection establishment
            setTimeout(() => resolve(undefined), 500);
          });
        });
      }
    }
  }

  // All configurations failed
  if (lastError) {
    throw new Error(getMediaErrorMessage(lastError));
  }
  
  throw new Error('Failed to access camera and microphone');
}

/**
 * Get user-friendly error message for media errors
 */
function getMediaErrorMessage(error: Error): string {
  switch (error.name) {
    case 'NotAllowedError':
      return 'Camera and microphone access denied. Please allow access in your browser settings and refresh the page.';
    case 'NotFoundError':
      return 'No camera or microphone found. Please check that your devices are connected and try again.';
    case 'NotReadableError':
      return 'Camera or microphone is already in use by another application. Please close other applications and try again.';
    case 'OverconstrainedError':
      return 'Your camera or microphone does not support the required settings. Please try with different devices.';
    case 'SecurityError':
      return 'Media access blocked due to security restrictions. Please check your browser settings.';
    case 'AbortError':
      return 'Media access was interrupted. Please try again.';
    default:
      return 'Failed to access camera and microphone. Please check your devices and browser permissions.';
  }
}

/**
 * Monitor WebRTC connection quality
 */
export class ConnectionQualityMonitor {
  private peerConnection: RTCPeerConnection;
  private onQualityChange: (quality: 'good' | 'fair' | 'poor') => void;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(peerConnection: RTCPeerConnection, onQualityChange: (quality: 'good' | 'fair' | 'poor') => void) {
    this.peerConnection = peerConnection;
    this.onQualityChange = onQualityChange;
  }

  start() {
    // REMOVED: Pre-connection quality monitoring (Requirements 4.2, 4.3)
    // Quality monitoring now only starts after connection is established
    console.log('⏭️ REMOVED: Pre-connection quality monitoring disabled');
    console.log('🔄 Quality monitoring will start after connection establishment');
    
    // Only start monitoring if connection is already established
    if (this.peerConnection.connectionState === 'connected') {
      // Import registerInterval to use the blocking mechanism
      import('./webrtc-manager').then(({ registerInterval }) => {
        this.intervalId = registerInterval(() => {
          this.checkQuality();
        }, 5000, 'Connection quality monitoring interval'); // Check every 5 seconds
        
        if (!this.intervalId) {
          console.log('⏭️ Connection quality monitoring interval blocked - connection already established');
        }
      }).catch(() => {
        // Fallback if import fails - use direct setInterval for quality monitoring
        // This should be rare and quality monitoring can continue even after connection
        this.intervalId = setInterval(() => {
          this.checkQuality();
        }, 5000);
      });
    } else {
      console.log('⏭️ Quality monitoring deferred until connection is established');
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async checkQuality() {
    try {
      const stats = await this.peerConnection.getStats();
      let packetsLost = 0;
      let packetsReceived = 0;
      let roundTripTime = 0;

      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
          packetsLost += report.packetsLost || 0;
          packetsReceived += report.packetsReceived || 0;
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          roundTripTime = report.currentRoundTripTime || 0;
        }
      });

      const packetLossRate = packetsReceived > 0 ? packetsLost / (packetsLost + packetsReceived) : 0;
      
      let quality: 'good' | 'fair' | 'poor' = 'good';
      
      if (packetLossRate > 0.05 || roundTripTime > 0.3) {
        quality = 'poor';
      } else if (packetLossRate > 0.02 || roundTripTime > 0.15) {
        quality = 'fair';
      }

      this.onQualityChange(quality);

    } catch (error) {
      console.error('Error monitoring connection quality:', error);
    }
  }
}