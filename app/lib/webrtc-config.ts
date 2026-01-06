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
 * Get WebRTC configuration optimized for network traversal
 * Automatically detects network environment and configures TURN servers
 */
export async function getWebRTCConfiguration(forceRelay: boolean = false): Promise<WebRTCConfig> {
  try {
    // Test TURN connectivity first if forcing relay mode
    if (forceRelay) {
      console.log('🔍 Testing TURN connectivity before forcing relay mode...');
      const hasTurn = await quickTURNCheck();
      if (!hasTurn) {
        console.error('❌ No working TURN servers found but relay mode requested!');
        console.error('This will cause immediate connection failure.');
        // Continue anyway but log the issue
      }
    }
    
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
      
      // Log individual TURN servers for debugging
      turnServers.forEach((server, index) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        const firstUrl = urls[0];
        console.log(`   TURN ${index + 1}: ${firstUrl} (${server.username ? 'authenticated' : 'no auth'})`);
      });
    } else {
      console.warn('⚠️ No TURN servers configured - may fail in restrictive networks');
      
      if (forceRelay) {
        throw new Error('Relay mode requested but no TURN servers available');
      }
    }
    
    return config;
  } catch (error) {
    console.error('❌ Failed to get WebRTC configuration:', error);
    
    // Fallback configuration with basic STUN servers
    const fallbackConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle' as RTCBundlePolicy,
      rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy
    };
    
    console.log('🔄 Using fallback STUN-only configuration');
    return fallbackConfig;
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
    // Direct RTCPeerConnection creation is acceptable here since this is for network testing
    // before any actual WebRTC connection is established
    const testPeerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    let resolved = false;
    
    // Import registerTimeout to use the blocking mechanism
    import('./webrtc-manager').then(({ registerTimeout }) => {
      const timeout = registerTimeout(() => {
        if (!resolved) {
          resolved = true;
          testPeerConnection.close();
          resolve(false);
        }
      }, 8000, 'STUN connectivity test timeout'); // Reduced timeout
      
      if (!timeout) {
        console.log('⏭️ STUN connectivity test timeout blocked - connection already established');
        // If timeout is blocked, resolve immediately with false
        if (!resolved) {
          resolved = true;
          testPeerConnection.close();
          resolve(false);
        }
      }
    }).catch(() => {
      // Fallback if import fails - use direct setTimeout for network testing
      // This is acceptable since network testing happens before connection establishment
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          testPeerConnection.close();
          resolve(false);
        }
      }, 8000);
    });

    testPeerConnection.onicecandidate = (event) => {
      if (event.candidate && event.candidate.type === 'srflx' && !resolved) {
        resolved = true;
        // Note: We can't clear the registered timeout directly, but it will be cleaned up by the lifecycle system
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
        // Note: We can't clear the registered timeout directly, but it will be cleaned up by the lifecycle system
        testPeerConnection.close();
        resolve(false);
      }
    });
  });
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