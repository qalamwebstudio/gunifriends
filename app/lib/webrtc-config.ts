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

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: 'all' | 'relay';
  iceCandidatePoolSize?: number;
  bundlePolicy?: RTCBundlePolicy;
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
}

/**
 * Get WebRTC configuration optimized for network traversal
 * Automatically detects network environment and configures TURN servers
 */
export async function getWebRTCConfiguration(forceRelay: boolean = false): Promise<WebRTCConfig> {
  try {
    // Get optimized configuration based on network environment
    const config = await getNetworkTraversalConfig(forceRelay);
    
    console.log(`🌐 WebRTC configuration loaded: ${config.iceServers.length} ICE servers`);
    console.log(`🔧 ICE transport policy: ${config.iceTransportPolicy}`);
    
    // Log TURN server availability
    const turnServers = config.iceServers.filter(server => 
      (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('turn')) : server.urls.startsWith('turn'))
    );
    
    if (turnServers.length > 0) {
      console.log(`✅ ${turnServers.length} TURN servers configured for NAT traversal`);
    } else {
      console.warn('⚠️ No TURN servers configured - may fail in restrictive networks');
    }
    
    return config;
  } catch (error) {
    console.error('❌ Failed to get WebRTC configuration:', error);
    
    // Fallback configuration with basic STUN servers
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };
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
 * Test network connectivity for WebRTC with enhanced TURN testing
 */
export async function testWebRTCConnectivity(): Promise<{
  hasInternet: boolean;
  hasSTUN: boolean;
  hasTURN: boolean;
  latency: number;
  networkType: 'open' | 'moderate' | 'restrictive';
  recommendedPolicy: 'all' | 'relay';
}> {
  try {
    // Use the enhanced network detection
    const networkEnv = await detectNetworkEnvironment();
    
    return {
      hasInternet: true,
      hasSTUN: networkEnv.networkType !== 'restrictive',
      hasTURN: !networkEnv.isRestrictive,
      latency: networkEnv.latency,
      networkType: networkEnv.networkType,
      recommendedPolicy: networkEnv.recommendedPolicy
    };
  } catch (error) {
    console.error('Network connectivity test failed:', error);
    
    // Fallback test
    const result = {
      hasInternet: false,
      hasSTUN: false,
      hasTURN: false,
      latency: 0,
      networkType: 'restrictive' as 'open' | 'moderate' | 'restrictive',
      recommendedPolicy: 'relay' as 'all' | 'relay'
    };

    try {
      // Test basic internet connectivity
      const startTime = Date.now();
      const response = await fetch('/api/health', { 
        method: 'GET',
        cache: 'no-cache',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        result.hasInternet = true;
        result.latency = Date.now() - startTime;
      }

      // Test STUN connectivity
      result.hasSTUN = await testSTUNConnectivity();

      // Determine network type based on results
      if (result.hasSTUN && result.latency < 500) {
        result.networkType = 'open';
        result.recommendedPolicy = 'all';
      } else if (result.hasSTUN && result.latency < 1000) {
        result.networkType = 'moderate';
        result.recommendedPolicy = 'all';
      }

    } catch (error) {
      console.error('Fallback connectivity test failed:', error);
    }

    return result;
  }
}

/**
 * Test STUN server connectivity (simplified version)
 */
async function testSTUNConnectivity(): Promise<boolean> {
  return new Promise((resolve) => {
    const testPeerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        testPeerConnection.close();
        resolve(false);
      }
    }, 8000); // Reduced timeout

    testPeerConnection.onicecandidate = (event) => {
      if (event.candidate && event.candidate.type === 'srflx' && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        testPeerConnection.close();
        resolve(true);
      }
    };

    // Create a dummy data channel to trigger ICE gathering
    testPeerConnection.createDataChannel('test');
    testPeerConnection.createOffer().then(offer => {
      return testPeerConnection.setLocalDescription(offer);
    }).catch(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        testPeerConnection.close();
        resolve(false);
      }
    });
  });
}

// Export the enhanced network traversal components
export { 
  NetworkTraversalMonitor, 
  performICERestart, 
  detectNetworkEnvironment 
} from './webrtc-network-traversal';

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
        setTimeout(() => reject(new Error('Media access timeout')), 10000);
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
        await new Promise(resolve => setTimeout(resolve, 500));
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
    this.intervalId = setInterval(() => {
      this.checkQuality();
    }, 5000); // Check every 5 seconds
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