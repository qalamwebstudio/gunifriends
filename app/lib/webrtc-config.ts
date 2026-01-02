/**
 * WebRTC Configuration and Utilities
 * Provides STUN/TURN server configuration and WebRTC helper functions
 */

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  iceCandidatePoolSize?: number;
  bundlePolicy?: RTCBundlePolicy;
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
}

/**
 * Get WebRTC configuration with fallback STUN/TURN servers
 */
export function getWebRTCConfiguration(): WebRTCConfig {
  const config: WebRTCConfig = {
    iceServers: [
      // Google STUN servers (primary)
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      
      // Additional STUN servers for redundancy
      { urls: 'stun:stun.services.mozilla.com' },
      { urls: 'stun:stun.stunprotocol.org:3478' },
      
      // Cloudflare STUN servers
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    iceCandidatePoolSize: 10, // Pre-gather ICE candidates
    bundlePolicy: 'max-bundle', // Bundle all media on single transport
    rtcpMuxPolicy: 'require', // Multiplex RTP and RTCP
  };

  // Add TURN servers if configured via environment variables
  const turnServer = process.env.NEXT_PUBLIC_TURN_SERVER;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnServer && turnUsername && turnCredential) {
    config.iceServers.push(
      {
        urls: `turn:${turnServer}:3478`,
        username: turnUsername,
        credential: turnCredential
      },
      {
        urls: `turns:${turnServer}:5349`,
        username: turnUsername,
        credential: turnCredential
      }
    );
    console.log('TURN servers configured for NAT traversal');
  } else {
    console.warn('TURN servers not configured - connections may fail behind restrictive NATs');
  }

  return config;
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
 * Test network connectivity for WebRTC
 */
export async function testWebRTCConnectivity(): Promise<{
  hasInternet: boolean;
  hasSTUN: boolean;
  hasTURN: boolean;
  latency: number;
}> {
  const result = {
    hasInternet: false,
    hasSTUN: false,
    hasTURN: false,
    latency: 0
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

    // Test TURN connectivity if configured
    const turnServer = process.env.NEXT_PUBLIC_TURN_SERVER;
    if (turnServer) {
      result.hasTURN = await testTURNConnectivity();
    }

  } catch (error) {
    console.error('Network connectivity test failed:', error);
  }

  return result;
}

/**
 * Test STUN server connectivity
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
    }, 10000);

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

/**
 * Test TURN server connectivity
 */
async function testTURNConnectivity(): Promise<boolean> {
  const turnServer = process.env.NEXT_PUBLIC_TURN_SERVER;
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (!turnServer || !turnUsername || !turnCredential) {
    return false;
  }

  return new Promise((resolve) => {
    const testPeerConnection = new RTCPeerConnection({
      iceServers: [{
        urls: `turn:${turnServer}:3478`,
        username: turnUsername,
        credential: turnCredential
      }]
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        testPeerConnection.close();
        resolve(false);
      }
    }, 15000); // Longer timeout for TURN

    testPeerConnection.onicecandidate = (event) => {
      if (event.candidate && event.candidate.type === 'relay' && !resolved) {
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

/**
 * Get media stream with fallback options
 */
export async function getMediaStreamWithFallback(): Promise<MediaStream> {
  const configurations = [
    MediaConstraints.high,
    MediaConstraints.medium,
    MediaConstraints.low,
    MediaConstraints.audioOnly
  ];

  let lastError: Error | null = null;

  for (let i = 0; i < configurations.length; i++) {
    try {
      console.log(`Attempting media configuration ${i + 1}/${configurations.length}`);
      const stream = await navigator.mediaDevices.getUserMedia(configurations[i]);
      
      if (i > 0) {
        console.log(`Successfully obtained media with fallback configuration ${i + 1}`);
      }
      
      return stream;
    } catch (error) {
      console.error(`Media configuration ${i + 1} failed:`, error);
      lastError = error as Error;
      
      // If this is a permission error, don't try other configurations
      if (error instanceof Error && error.name === 'NotAllowedError') {
        break;
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