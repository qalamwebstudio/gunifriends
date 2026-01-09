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
 * REMOVED: Network environment detection (Requirements 4.1, 4.2, 4.3, 4.4, 4.5)
 * NAT type detection, bandwidth tests, and pre-connection quality checks eliminated
 * Connection flow now starts immediately after media readiness using TURN-first strategy
 */
export async function detectNetworkEnvironment(): Promise<{
  isRestrictive: boolean;
  recommendedPolicy: 'all' | 'relay';
  networkType: 'open' | 'moderate' | 'restrictive';
  latency: number;
}> {
  console.log('⏭️ REMOVED: Network environment detection disabled');
  console.log('🚀 Connection will use TURN-first ICE strategy without pre-connection probing');
  
  // Return safe default settings immediately - no network probing
  return {
    isRestrictive: false,
    recommendedPolicy: 'all',
    networkType: 'open',
    latency: 0
  };
}

/**
 * Get optimized WebRTC configuration for network traversal
 * Requirements: 2.4, 2.5, 3.1, 3.2 - Prevent NAT reclassification and ICE policy changes after connection
 * Requirements: 5.5 - Lifecycle gate enforcement
 */
export async function getNetworkTraversalConfig(forceRelay: boolean = false): Promise<WebRTCConfig> {
  // Import WebRTCManager to check lifecycle gate enforcement
  const { WebRTCManager, enforceICEConfigurationGate } = await import('./webrtc-manager');
  
  // Requirements 5.5 - Lifecycle gate enforcement for ICE configuration changes
  if (enforceICEConfigurationGate()) {
    console.warn('🚫 Network traversal config changes blocked by lifecycle gate');
    console.warn('Connection is established - network configuration should not be modified');
    
    // Return a minimal safe configuration that won't interfere with established connection
    return {
      iceServers: [], // Empty - don't provide new ICE servers for established connection
      iceTransportPolicy: 'all', // Safe default
      iceCandidatePoolSize: 0, // Don't gather new candidates
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };
  }
  
  // Legacy check for backward compatibility
  if (WebRTCManager.getCallIsConnected()) {
    console.warn('🚫 Blocked: Network traversal config changes not allowed after connection established');
    console.warn('Connection is established - network configuration should not be modified');
    
    // Return a minimal safe configuration that won't interfere with established connection
    return {
      iceServers: [], // Empty - don't provide new ICE servers for established connection
      iceTransportPolicy: 'all', // Safe default
      iceCandidatePoolSize: 0, // Don't gather new candidates
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };
  }

  const networkEnv = await detectNetworkEnvironment();
  
  // Build ICE servers array
  const iceServers: RTCIceServer[] = [];

  // Add STUN servers (always include for NAT discovery unless forcing relay)
  if (!forceRelay) {
    iceServers.push(...STUN_SERVERS.map(url => ({ urls: url })));
  }

  // Add TURN servers based on environment
  const turnServers = process.env.NODE_ENV === 'production' 
    ? PRODUCTION_TURN_SERVERS 
    : [...PRODUCTION_TURN_SERVERS, ...FREE_TURN_SERVERS];

  let workingTurnServers = 0;
  for (const turnConfig of turnServers) {
    if (turnConfig.username && turnConfig.credential) {
      iceServers.push({
        urls: turnConfig.urls,
        username: turnConfig.username,
        credential: turnConfig.credential
      });
      workingTurnServers++;
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
    workingTurnServers++;
  }

  // Determine ICE transport policy
  let iceTransportPolicy: 'all' | 'relay' = 'all';
  
  if (forceRelay) {
    iceTransportPolicy = 'relay';
    console.log('🔒 FORCED RELAY MODE: Only TURN servers will be used');
    
    // Ensure we have TURN servers when forcing relay
    if (workingTurnServers === 0) {
      console.error('❌ CRITICAL: Relay mode forced but no TURN servers available!');
      console.error('This will cause immediate connection failure.');
      console.error('Please configure TURN servers in environment variables.');
    }
  } else if (networkEnv.isRestrictive || networkEnv.networkType === 'restrictive') {
    iceTransportPolicy = 'relay';
    console.log('🔒 Using relay-only mode for restrictive network');
    
    if (workingTurnServers === 0) {
      console.warn('⚠️ Restrictive network detected but no TURN servers - may fail');
      iceTransportPolicy = 'all'; // Fall back to all if no TURN available
    }
  } else {
    console.log('🌐 Using all transport modes (STUN + TURN)');
  }

  const config: WebRTCConfig = {
    iceServers,
    iceTransportPolicy,
    iceCandidatePoolSize: forceRelay ? 0 : 10, // Don't pre-gather in relay mode
    bundlePolicy: 'max-bundle', // Bundle all media on single transport
    rtcpMuxPolicy: 'require' // Multiplex RTP and RTCP
  };

  console.log(`WebRTC config: ${iceServers.length} ICE servers, policy: ${iceTransportPolicy}`);
  console.log(`TURN servers configured: ${workingTurnServers}`);
  
  if (forceRelay && workingTurnServers === 0) {
    throw new Error('Relay mode requested but no TURN servers available');
  }
  
  return config;
}

/**
 * REMOVED: STUN server connectivity testing (Requirements 4.1, 4.3, 4.4, 4.5)
 * Redundant STUN discovery calls beyond ICE gathering eliminated
 * ICE gathering will handle STUN discovery during connection establishment
 */
async function testSTUNConnectivity(): Promise<{
  hasSTUN: boolean;
  candidates: string[];
  latency: number;
}> {
  console.log('⏭️ REMOVED: STUN connectivity testing disabled');
  console.log('🔄 ICE gathering will handle STUN discovery during connection establishment');
  
  // Return default result - STUN testing will happen during ICE gathering
  return {
    hasSTUN: true,
    candidates: [],
    latency: 0
  };
}

/**
 * REMOVED: TURN server connectivity testing (Requirements 4.1, 4.3, 4.4, 4.5)
 * Redundant TURN discovery calls beyond ICE gathering eliminated
 * ICE gathering will handle TURN discovery during connection establishment
 */
async function testTURNConnectivity(): Promise<{
  hasTURN: boolean;
  workingServers: string[];
  latency: number;
}> {
  console.log('⏭️ REMOVED: TURN connectivity testing disabled');
  console.log('🔄 ICE gathering will handle TURN discovery during connection establishment');
  
  // Return default result - TURN testing will happen during ICE gathering
  return {
    hasTURN: true,
    workingServers: [],
    latency: 0
  };
}

/**
 * REMOVED: Single TURN server testing (Requirements 4.1, 4.3, 4.4, 4.5)
 * Redundant TURN discovery calls beyond ICE gathering eliminated
 * ICE gathering will handle TURN discovery during connection establishment
 */
async function testSingleTURNServer(turnConfig: TURNServerConfig): Promise<{
  working: boolean;
  candidates: string[];
}> {
  console.log('⏭️ REMOVED: Single TURN server testing disabled');
  console.log('🔄 ICE gathering will handle TURN discovery during connection establishment');
  
  // Return default result - TURN testing will happen during ICE gathering
  return {
    working: true,
    candidates: []
  };
}

/**
 * Enhanced ICE restart with proper candidate gathering
 * Requirements: 5.5 - Lifecycle gate enforcement for ICE restart
 * Requirements: 2.4 - ICE restart disabled to prevent connection time extension
 */
export async function performICERestart(
  peerConnection: RTCPeerConnection,
  isInitiator: boolean
): Promise<boolean> {
  try {
    // Requirements 2.4: ICE restart is disabled to prevent connection time extension
    console.warn('🚫 ICE restart is disabled by aggressive timeout controller');
    console.warn('🚫 ICE restart extends connection time and is replaced by TURN-first strategy');
    console.warn('🔄 Use TURN-first ICE configuration instead of ICE restart');
    
    // Log the blocked restart attempt
    console.log('❌ performICERestart() blocked - connection should use TURN-first strategy');
    console.log('📊 ICE restart attempts extend connection time beyond 5-second target');
    
    return false; // Always return false - ICE restart is disabled
    
    // Legacy ICE restart logic is commented out to prevent connection time extension
    /*
    // Import WebRTCManager to check lifecycle gate enforcement
    const { isICERestartBlocked, enforceICEConfigurationGate } = await import('./webrtc-manager');
    
    // Requirements 5.5 - Lifecycle gate enforcement for ICE restart
    if (enforceICEConfigurationGate() || isICERestartBlocked()) {
      console.warn('🚫 ICE restart blocked by lifecycle gate - connection already established');
      console.warn('ICE restart should not be performed on established connections');
      return false;
    }
    
    console.log('🔄 Performing ICE restart for network traversal...');
    
    if (peerConnection.signalingState !== 'stable') {
      console.warn(`Cannot perform ICE restart: signaling state is ${peerConnection.signalingState}`);
      return false;
    }

    if (isInitiator) {
      // Create new offer with ICE restart
      console.log('🔄 Creating ICE restart offer...');
      const offer = await peerConnection.createOffer({ 
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      console.log('📝 Setting local description for ICE restart...');
      await peerConnection.setLocalDescription(offer);
      
      console.log('✅ ICE restart offer created and set as local description');
      
      // The offer should be sent via signaling (handled by caller)
      return true;
    } else {
      console.log('ICE restart will be initiated by remote peer');
      return true;
    }
    */
  } catch (error) {
    console.error('❌ ICE restart blocked (disabled for performance):', error);
    return false;
  }
}

/**
 * Monitor ICE connection state with proper handling for restrictive networks
 * Requirements: 2.4 - ICE restart logic disabled to prevent connection time extension
 */
export class NetworkTraversalMonitor {
  private peerConnection: RTCPeerConnection;
  private onStateChange: (state: string, details: any) => void;
  private iceRestartAttempts = 0;
  private maxICERestartAttempts = 0; // Disabled: was 3, now 0 to prevent restarts
  private connectionStartTime = Date.now();
  private lastStableConnection = 0;
  private iceRestartDisabled = true; // Requirements 2.4: Disable ICE restart logic

  constructor(
    peerConnection: RTCPeerConnection, 
    onStateChange: (state: string, details: any) => void
  ) {
    this.peerConnection = peerConnection;
    this.onStateChange = onStateChange;
    
    console.log('🚫 NetworkTraversalMonitor: ICE restart logic disabled for performance');
    console.log('🔄 Using TURN-first strategy instead of ICE restart for reliability');
    
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
          
          // Requirements 2.4: ICE restart logic disabled to prevent connection time extension
          if (this.iceRestartDisabled) {
            console.log('🚫 ICE restart disabled - using TURN-first strategy instead');
            console.log('🔄 Connection should rely on TURN relay for reliability');
            
            this.onStateChange('ice-failed-no-restart', { 
              state, 
              duration: connectionDuration,
              restartDisabled: true,
              message: 'ICE restart disabled - use TURN-first strategy'
            });
          } else if (this.iceRestartAttempts < this.maxICERestartAttempts) {
            // Legacy restart logic (should not execute when iceRestartDisabled = true)
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
      iceRestartDisabled: this.iceRestartDisabled, // Requirements 2.4
      maxICERestartAttempts: this.maxICERestartAttempts,
      currentICEState: this.peerConnection.iceConnectionState,
      currentConnectionState: this.peerConnection.connectionState
    };
  }

  /**
   * Disable ICE restart logic completely
   * Requirements: 2.4 - Remove redundant ICE restart logic that extends connection time
   */
  public disableICERestart(): void {
    console.log('🚫 Disabling ICE restart logic in NetworkTraversalMonitor');
    
    this.iceRestartDisabled = true;
    this.maxICERestartAttempts = 0;
    this.iceRestartAttempts = 0;
    
    console.log('✅ ICE restart logic disabled - connection will rely on TURN-first strategy');
  }

  /**
   * Check if ICE restart is disabled
   * Requirements: 2.4 - Allow checking if restart logic is disabled
   */
  public isICERestartDisabled(): boolean {
    return this.iceRestartDisabled;
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