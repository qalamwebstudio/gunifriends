/**
 * WebRTC Network Traversal Configuration
 * Comprehensive TURN server setup and ICE handling for restrictive networks
 * Fixes 40-50 second connection drops in college/office WiFi environments
 */

import type { WebRTCConfig } from './webrtc-config';

export interface TURNServerConfig {
  urls: string | string[];
  username: string;
  credential: string;
  credentialType?: 'password' | 'oauth';
}

export interface NetworkTraversalConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: 'all' | 'relay';
  iceCandidatePoolSize: number;
  bundlePolicy: 'balanced' | 'max-compat' | 'max-bundle';
  rtcpMuxPolicy: 'negotiate' | 'require';
}

/**
 * Production-ready TURN server configurations
 * These are reliable TURN providers for production use
 */
const PRODUCTION_TURN_SERVERS: TURNServerConfig[] = [
  // Metered.ca - Reliable and affordable TURN service
  {
    urls: [
      'turn:a.relay.metered.ca:80',
      'turn:a.relay.metered.ca:80?transport=tcp',
      'turn:a.relay.metered.ca:443',
      'turn:a.relay.metered.ca:443?transport=tcp',
      'turns:a.relay.metered.ca:443?transport=tcp'
    ],
    username: process.env.NEXT_PUBLIC_METERED_TURN_USERNAME || 'demo-username',
    credential: process.env.NEXT_PUBLIC_METERED_TURN_CREDENTIAL || 'demo-credential'
  },
  // Twilio STUN/TURN (requires account)
  {
    urls: [
      'turn:global.turn.twilio.com:3478?transport=udp',
      'turn:global.turn.twilio.com:3478?transport=tcp',
      'turn:global.turn.twilio.com:443?transport=tcp'
    ],
    username: process.env.NEXT_PUBLIC_TWILIO_TURN_USERNAME || '',
    credential: process.env.NEXT_PUBLIC_TWILIO_TURN_CREDENTIAL || ''
  },
  // Xirsys (requires account)
  {
    urls: [
      'turn:ss-turn1.xirsys.com:80?transport=udp',
      'turn:ss-turn1.xirsys.com:3478?transport=udp',
      'turn:ss-turn1.xirsys.com:80?transport=tcp',
      'turn:ss-turn1.xirsys.com:3478?transport=tcp',
      'turns:ss-turn1.xirsys.com:443?transport=tcp',
      'turns:ss-turn1.xirsys.com:5349?transport=tcp'
    ],
    username: process.env.NEXT_PUBLIC_XIRSYS_TURN_USERNAME || '',
    credential: process.env.NEXT_PUBLIC_XIRSYS_TURN_CREDENTIAL || ''
  }
];

/**
 * Free TURN servers for development/testing
 * Note: These may have limitations and should not be used in production
 */
const FREE_TURN_SERVERS: TURNServerConfig[] = [
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:relay1.expressturn.com:3478',
    username: 'efJBIBF6DKC8QBA6XB',
    credential: 'Ghq6EzYyZJQcZnOh'
  }
];

/**
 * Comprehensive STUN server list for NAT discovery
 */
const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun3.l.google.com:19302',
  'stun:stun4.l.google.com:19302',
  'stun:stun.services.mozilla.com',
  'stun:stun.stunprotocol.org:3478',
  'stun:stun.cloudflare.com:3478'
];

/**
 * Detect network environment and recommend ICE transport policy
 */
export async function detectNetworkEnvironment(): Promise<{
  isRestrictive: boolean;
  recommendedPolicy: 'all' | 'relay';
  networkType: 'open' | 'moderate' | 'restrictive';
  latency: number;
}> {
  try {
    // Test basic connectivity and latency
    const startTime = Date.now();
    const response = await fetch('/api/health', { 
      method: 'GET',
      cache: 'no-cache',
      signal: AbortSignal.timeout(5000)
    });
    const latency = Date.now() - startTime;

    // Test STUN connectivity
    const stunResult = await testSTUNConnectivity();
    
    // Test if we can reach TURN servers
    const turnResult = await testTURNConnectivity();

    // Determine network restrictiveness
    let networkType: 'open' | 'moderate' | 'restrictive' = 'open';
    let recommendedPolicy: 'all' | 'relay' = 'all';

    if (!stunResult.hasSTUN || latency > 1000) {
      networkType = 'restrictive';
      recommendedPolicy = 'relay';
    } else if (!turnResult.hasTURN || latency > 500) {
      networkType = 'moderate';
      recommendedPolicy = 'all'; // Try both, but prefer TURN
    }

    console.log(`Network environment detected: ${networkType} (latency: ${latency}ms)`);
    console.log(`Recommended ICE transport policy: ${recommendedPolicy}`);

    return {
      isRestrictive: networkType === 'restrictive',
      recommendedPolicy,
      networkType,
      latency
    };
  } catch (error) {
    console.error('Network detection failed:', error);
    // Default to restrictive settings for safety
    return {
      isRestrictive: true,
      recommendedPolicy: 'relay',
      networkType: 'restrictive',
      latency: 9999
    };
  }
}

/**
 * Get optimized WebRTC configuration for network traversal
 */
export async function getNetworkTraversalConfig(forceRelay: boolean = false): Promise<WebRTCConfig> {
  const networkEnv = await detectNetworkEnvironment();
  
  // Build ICE servers array
  const iceServers: RTCIceServer[] = [];

  // Add STUN servers (always include for NAT discovery)
  iceServers.push(...STUN_SERVERS.map(url => ({ urls: url })));

  // Add TURN servers based on environment
  const turnServers = process.env.NODE_ENV === 'production' 
    ? PRODUCTION_TURN_SERVERS 
    : [...PRODUCTION_TURN_SERVERS, ...FREE_TURN_SERVERS];

  for (const turnConfig of turnServers) {
    if (turnConfig.username && turnConfig.credential) {
      iceServers.push({
        urls: turnConfig.urls,
        username: turnConfig.username,
        credential: turnConfig.credential
      });
    }
  }

  // Add custom TURN servers from environment
  const customTurnServer = process.env.NEXT_PUBLIC_TURN_SERVER;
  const customTurnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const customTurnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (customTurnServer && customTurnUsername && customTurnCredential) {
    iceServers.push(
      {
        urls: `turn:${customTurnServer}:3478`,
        username: customTurnUsername,
        credential: customTurnCredential
      },
      {
        urls: `turns:${customTurnServer}:5349`,
        username: customTurnUsername,
        credential: customTurnCredential
      },
      {
        urls: `turn:${customTurnServer}:80?transport=tcp`,
        username: customTurnUsername,
        credential: customTurnCredential
      },
      {
        urls: `turn:${customTurnServer}:443?transport=tcp`,
        username: customTurnUsername,
        credential: customTurnCredential
      }
    );
  }

  // Determine ICE transport policy
  let iceTransportPolicy: 'all' | 'relay' = 'all';
  
  if (forceRelay || networkEnv.isRestrictive || networkEnv.networkType === 'restrictive') {
    iceTransportPolicy = 'relay';
    console.log('🔒 Using relay-only mode for restrictive network');
  } else {
    console.log('🌐 Using all transport modes (STUN + TURN)');
  }

  const config: WebRTCConfig = {
    iceServers,
    iceTransportPolicy,
    iceCandidatePoolSize: 10, // Pre-gather candidates
    bundlePolicy: 'max-bundle', // Bundle all media on single transport
    rtcpMuxPolicy: 'require' // Multiplex RTP and RTCP
  };

  console.log(`WebRTC config: ${iceServers.length} ICE servers, policy: ${iceTransportPolicy}`);
  
  return config;
}

/**
 * Test STUN server connectivity
 */
async function testSTUNConnectivity(): Promise<{
  hasSTUN: boolean;
  candidates: string[];
  latency: number;
}> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const candidates: string[] = [];
    
    const testPeerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        testPeerConnection.close();
        resolve({
          hasSTUN: false,
          candidates,
          latency: Date.now() - startTime
        });
      }
    }, 10000);

    testPeerConnection.onicecandidate = (event) => {
      if (event.candidate && event.candidate.type) {
        candidates.push(event.candidate.type);
        
        if (event.candidate.type === 'srflx' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          testPeerConnection.close();
          resolve({
            hasSTUN: true,
            candidates,
            latency: Date.now() - startTime
          });
        }
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
        resolve({
          hasSTUN: false,
          candidates,
          latency: Date.now() - startTime
        });
      }
    });
  });
}

/**
 * Test TURN server connectivity
 */
async function testTURNConnectivity(): Promise<{
  hasTURN: boolean;
  workingServers: string[];
  latency: number;
}> {
  const startTime = Date.now();
  const workingServers: string[] = [];
  
  // Test the first available TURN server
  const turnServers = process.env.NODE_ENV === 'production' 
    ? PRODUCTION_TURN_SERVERS 
    : FREE_TURN_SERVERS;

  for (const turnConfig of turnServers) {
    if (!turnConfig.username || !turnConfig.credential) continue;

    try {
      const result = await testSingleTURNServer(turnConfig);
      if (result.working) {
        workingServers.push(Array.isArray(turnConfig.urls) ? turnConfig.urls[0] : turnConfig.urls);
      }
    } catch (error) {
      console.warn('TURN server test failed:', error);
    }
  }

  return {
    hasTURN: workingServers.length > 0,
    workingServers,
    latency: Date.now() - startTime
  };
}

/**
 * Test a single TURN server
 */
async function testSingleTURNServer(turnConfig: TURNServerConfig): Promise<{
  working: boolean;
  candidates: string[];
}> {
  return new Promise((resolve) => {
    const candidates: string[] = [];
    const testPeerConnection = new RTCPeerConnection({
      iceServers: [{
        urls: Array.isArray(turnConfig.urls) ? turnConfig.urls[0] : turnConfig.urls,
        username: turnConfig.username,
        credential: turnConfig.credential
      }]
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        testPeerConnection.close();
        resolve({ working: false, candidates });
      }
    }, 15000); // Longer timeout for TURN

    testPeerConnection.onicecandidate = (event) => {
      if (event.candidate && event.candidate.type) {
        candidates.push(event.candidate.type);
        
        if (event.candidate.type === 'relay' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          testPeerConnection.close();
          resolve({ working: true, candidates });
        }
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
        resolve({ working: false, candidates });
      }
    });
  });
}

/**
 * Enhanced ICE restart with proper candidate gathering
 */
export async function performICERestart(
  peerConnection: RTCPeerConnection,
  isInitiator: boolean
): Promise<boolean> {
  try {
    console.log('🔄 Performing ICE restart for network traversal...');
    
    if (peerConnection.signalingState !== 'stable') {
      console.warn('Cannot perform ICE restart: signaling state is not stable');
      return false;
    }

    if (isInitiator) {
      // Create new offer with ICE restart
      const offer = await peerConnection.createOffer({ 
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peerConnection.setLocalDescription(offer);
      console.log('✅ ICE restart offer created and set as local description');
      
      // The offer should be sent via signaling (handled by caller)
      return true;
    } else {
      console.log('ICE restart initiated by remote peer');
      return true;
    }
  } catch (error) {
    console.error('❌ ICE restart failed:', error);
    return false;
  }
}

/**
 * Monitor ICE connection state with proper handling for restrictive networks
 */
export class NetworkTraversalMonitor {
  private peerConnection: RTCPeerConnection;
  private onStateChange: (state: string, details: any) => void;
  private iceRestartAttempts = 0;
  private maxICERestartAttempts = 3;
  private connectionStartTime = Date.now();
  private lastStableConnection = 0;

  constructor(
    peerConnection: RTCPeerConnection, 
    onStateChange: (state: string, details: any) => void
  ) {
    this.peerConnection = peerConnection;
    this.onStateChange = onStateChange;
    this.setupMonitoring();
  }

  private setupMonitoring() {
    // Monitor ICE connection state
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection.iceConnectionState;
      const connectionDuration = Date.now() - this.connectionStartTime;
      
      console.log(`🔗 ICE connection state: ${state} (duration: ${connectionDuration}ms)`);
      
      switch (state) {
        case 'connected':
        case 'completed':
          this.lastStableConnection = Date.now();
          this.iceRestartAttempts = 0; // Reset on successful connection
          this.onStateChange('ice-connected', { 
            state, 
            duration: connectionDuration,
            restartAttempts: this.iceRestartAttempts 
          });
          break;
          
        case 'disconnected':
          // Handle temporary disconnections (common in restrictive networks)
          const timeSinceLastStable = Date.now() - this.lastStableConnection;
          console.log(`⚠️ ICE disconnected after ${timeSinceLastStable}ms of stable connection`);
          
          this.onStateChange('ice-disconnected', { 
            state, 
            timeSinceLastStable,
            duration: connectionDuration 
          });
          break;
          
        case 'failed':
          console.log(`❌ ICE connection failed after ${connectionDuration}ms`);
          
          if (this.iceRestartAttempts < this.maxICERestartAttempts) {
            this.iceRestartAttempts++;
            console.log(`🔄 Attempting ICE restart ${this.iceRestartAttempts}/${this.maxICERestartAttempts}`);
            
            this.onStateChange('ice-restart-needed', { 
              state, 
              attempt: this.iceRestartAttempts,
              maxAttempts: this.maxICERestartAttempts,
              duration: connectionDuration
            });
          } else {
            console.log('🚫 Maximum ICE restart attempts reached');
            this.onStateChange('ice-failed-permanently', { 
              state, 
              attempts: this.iceRestartAttempts,
              duration: connectionDuration
            });
          }
          break;
          
        case 'closed':
          this.onStateChange('ice-closed', { state, duration: connectionDuration });
          break;
      }
    };

    // Monitor connection state
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      const connectionDuration = Date.now() - this.connectionStartTime;
      
      console.log(`🔗 Connection state: ${state} (duration: ${connectionDuration}ms)`);
      
      this.onStateChange('connection-state-changed', { 
        state, 
        duration: connectionDuration,
        iceState: this.peerConnection.iceConnectionState
      });
    };
  }

  public getConnectionStats() {
    return {
      connectionDuration: Date.now() - this.connectionStartTime,
      timeSinceLastStable: Date.now() - this.lastStableConnection,
      iceRestartAttempts: this.iceRestartAttempts,
      currentICEState: this.peerConnection.iceConnectionState,
      currentConnectionState: this.peerConnection.connectionState
    };
  }
}

/**
 * Self-hosted coturn server setup instructions
 */
export const COTURN_SETUP_GUIDE = `
# Self-hosted coturn TURN server setup for production

## 1. Install coturn on Ubuntu/Debian:
sudo apt-get update
sudo apt-get install coturn

## 2. Configure /etc/turnserver.conf:
listening-port=3478
tls-listening-port=5349
listening-ip=YOUR_SERVER_IP
external-ip=YOUR_SERVER_IP
relay-ip=YOUR_SERVER_IP

realm=YOUR_DOMAIN
server-name=YOUR_DOMAIN

lt-cred-mech
user=username:password

cert=/path/to/ssl/cert.pem
pkey=/path/to/ssl/private.key

no-stdout-log
log-file=/var/log/turnserver.log
verbose

## 3. Enable and start service:
sudo systemctl enable coturn
sudo systemctl start coturn

## 4. Firewall configuration:
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp

## 5. Test your TURN server:
Use online TURN server test tools or the testTURNConnectivity function
`;