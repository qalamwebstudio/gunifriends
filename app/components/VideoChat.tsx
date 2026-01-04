'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '../types';
import ReportModal from './ReportModal';
import { 
  getWebRTCConfiguration, 
  testWebRTCConnectivity, 
  getMediaStreamWithFallback, 
  ConnectionQualityMonitor,
  NetworkTraversalMonitor,
  performICERestart,
  detectNetworkEnvironment
} from '../lib/webrtc-config';
import { 
  CONNECTION_CONFIG,
  calculateExponentialBackoff,
  getTimeoutForPhase,
  getSessionTimeout,
  INITIAL_CONNECTION_TIMEOUT_MS,
  ICE_GATHERING_TIMEOUT_MS,
  CONNECTION_SETUP_EXTENSION_MS,
  MAX_RECONNECT_ATTEMPTS,
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  EXPONENTIAL_BACKOFF_MULTIPLIER,
  DISCONNECTION_GRACE_PERIOD_MS,
  ICE_FAILURE_GRACE_PERIOD_MS
} from '../lib/connection-config';

interface VideoChatProps {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  partnerId: string;
  roomId: string;
  onCallEnd: () => void;
  onError: (error: string) => void;
  isSessionRestored?: boolean;
}

type ConnectionState = 'initializing' | 'connecting' | 'connected' | 'disconnected' | 'failed';

export default function VideoChat({ socket, partnerId, roomId, onCallEnd, onError, isSessionRestored = false }: VideoChatProps) {
  // Video element refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
  // WebRTC refs
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const qualityMonitorRef = useRef<ConnectionQualityMonitor | null>(null);
  
  // State
  const [connectionState, setConnectionState] = useState<ConnectionState>('initializing');
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [isInitiator, setIsInitiator] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [initialConnectionTimeout, setInitialConnectionTimeout] = useState<NodeJS.Timeout | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [partnerTemporarilyDisconnected, setPartnerTemporarilyDisconnected] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<'good' | 'fair' | 'poor'>('good');
  const [adaptiveStreamingEnabled, setAdaptiveStreamingEnabled] = useState(false);
  const [isConnectionEstablished, setIsConnectionEstablished] = useState(false);

  // Enhanced WebRTC network traversal state
  const [networkType, setNetworkType] = useState<'open' | 'moderate' | 'restrictive'>('open');
  const [forceRelayMode, setForceRelayMode] = useState(false);
  const [iceRestartAttempts, setIceRestartAttempts] = useState(0);
  const [lastStableConnection, setLastStableConnection] = useState(0);
  const networkTraversalMonitorRef = useRef<any>(null);
  
  // Grace period timers for connection state handling (Requirements 3.1, 3.2, 3.5)
  const [disconnectionGraceTimer, setDisconnectionGraceTimer] = useState<NodeJS.Timeout | null>(null);
  const [iceFailureGraceTimer, setIceFailureGraceTimer] = useState<NodeJS.Timeout | null>(null);
  const [activeTimeoutTimers, setActiveTimeoutTimers] = useState<Set<NodeJS.Timeout>>(new Set());

  // Constants for error handling and retry logic (Requirements 4.2, 4.5)
  // Using centralized configuration for consistent timeout values
  const MAX_RECONNECT_ATTEMPTS_CONST = MAX_RECONNECT_ATTEMPTS; // 5 attempts for better reliability
  
  // Separate timeouts for different connection phases (Requirements 4.1, 4.4)
  const INITIAL_CONNECTION_TIMEOUT_CONST = INITIAL_CONNECTION_TIMEOUT_MS; // 60s for initial setup
  const CONNECTION_SETUP_EXTENSION_CONST = CONNECTION_SETUP_EXTENSION_MS; // 15s extension for retries
  const INITIAL_RECONNECT_DELAY_CONST = INITIAL_RECONNECT_DELAY_MS; // 2s base delay
  const MAX_RECONNECT_DELAY_CONST = MAX_RECONNECT_DELAY_MS; // 30s maximum delay
  const EXPONENTIAL_BACKOFF_MULTIPLIER_CONST = EXPONENTIAL_BACKOFF_MULTIPLIER; // 2x multiplier
  const ICE_GATHERING_TIMEOUT_CONST = ICE_GATHERING_TIMEOUT_MS; // 15s for ICE gathering
  
  // Grace periods for temporary connection issues (Requirements 3.1, 3.2, 3.5, 4.4)
  const DISCONNECTION_GRACE_PERIOD_CONST = DISCONNECTION_GRACE_PERIOD_MS; // 10s grace period
  const ICE_FAILURE_GRACE_PERIOD_CONST = ICE_FAILURE_GRACE_PERIOD_MS; // 5s grace period

  // Utility function for calculating exponential backoff delays (Requirements 4.2)
  const calculateExponentialBackoffDelay = (attempt: number, baseDelay: number = INITIAL_RECONNECT_DELAY_CONST, maxDelay: number = MAX_RECONNECT_DELAY_CONST): number => {
    return calculateExponentialBackoff(attempt, baseDelay, maxDelay);
  };

  // WebRTC configuration with STUN/TURN servers for NAT traversal
  const rtcConfiguration = getWebRTCConfiguration();

  // Helper functions for timeout management (Requirements 3.5)
  const addTimeoutTimer = (timer: NodeJS.Timeout) => {
    setActiveTimeoutTimers(prev => new Set([...prev, timer]));
  };

  const removeTimeoutTimer = (timer: NodeJS.Timeout) => {
    setActiveTimeoutTimers(prev => {
      const newSet = new Set(prev);
      newSet.delete(timer);
      return newSet;
    });
  };

  const clearAllTimeoutTimers = () => {
    activeTimeoutTimers.forEach(timer => clearTimeout(timer));
    setActiveTimeoutTimers(new Set());
  };

  const clearGraceTimers = () => {
    if (disconnectionGraceTimer) {
      clearTimeout(disconnectionGraceTimer);
      setDisconnectionGraceTimer(null);
    }
    if (iceFailureGraceTimer) {
      clearTimeout(iceFailureGraceTimer);
      setIceFailureGraceTimer(null);
    }
  };

  // Initialize media stream and WebRTC connection
  useEffect(() => {
    // Always initialize normally - don't delay for session restoration
    initializeVideoChat();
    
    return () => {
      cleanup();
    };
  }, []);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('offer', handleReceiveOffer);
    socket.on('answer', handleReceiveAnswer);
    socket.on('ice-candidate', handleReceiveIceCandidate);
    socket.on('call-ended', handleCallEnded);
    socket.on('partner-disconnected', handlePartnerDisconnected);
    socket.on('partner-timeout', handlePartnerTimeout);
    socket.on('partner-temporarily-disconnected', handlePartnerTemporarilyDisconnected);
    socket.on('partner-reconnected', handlePartnerReconnected);
    socket.on('session-timeout', handleSessionTimeout);
    socket.on('session-restored', handleSessionRestored);
    socket.on('session-restore-failed', handleSessionRestoreFailed);
    
    // Handle socket errors
    socket.on('error', (errorMessage) => {
      console.error('Socket error in VideoChat:', errorMessage);
      
      // Don't immediately end call on partner session errors - try to recover
      if (errorMessage.includes('Partner session not found') || 
          errorMessage.includes('No active partner session') ||
          errorMessage.includes('Partner not connected')) {
        console.log('Partner session error in VideoChat - attempting recovery...');
        onError(`Connection issue: ${errorMessage}. Attempting to reconnect...`);
        
        // Try to recover by recreating the connection
        setTimeout(() => {
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST) {
            console.log('Attempting to recover from partner session error...');
            attemptReconnection();
          } else {
            console.log('Max recovery attempts reached, ending call');
            onError('Unable to establish connection with partner. Please try again.');
            setTimeout(() => onCallEnd(), 3000);
          }
        }, 2000);
      } else {
        onError(errorMessage);
      }
    });

    return () => {
      socket.off('offer', handleReceiveOffer);
      socket.off('answer', handleReceiveAnswer);
      socket.off('ice-candidate', handleReceiveIceCandidate);
      socket.off('call-ended', handleCallEnded);
      socket.off('partner-disconnected', handlePartnerDisconnected);
      socket.off('partner-timeout', handlePartnerTimeout);
      socket.off('partner-temporarily-disconnected', handlePartnerTemporarilyDisconnected);
      socket.off('partner-reconnected', handlePartnerReconnected);
      socket.off('session-timeout', handleSessionTimeout);
      socket.off('session-restored', handleSessionRestored);
      socket.off('session-restore-failed', handleSessionRestoreFailed);
      socket.off('error');
    };
  }, [socket]);

  // Session state restoration for reconnections (Requirements 5.4, 5.5)
  const [sessionState, setSessionState] = useState<{
    partnerId?: string;
    roomId?: string;
    connectionEstablished?: boolean;
    mediaSettings?: {
      audioMuted: boolean;
      videoDisabled: boolean;
    };
    lastConnectionTime?: number;
  }>({});

  // Save session state periodically for restoration (Requirements 5.5)
  useEffect(() => {
    if (connectionState === 'connected' && partnerId && roomId) {
      const currentSessionState = {
        partnerId,
        roomId,
        connectionEstablished: isConnectionEstablished,
        mediaSettings: {
          audioMuted: isAudioMuted,
          videoDisabled: isVideoDisabled
        },
        lastConnectionTime: Date.now()
      };
      
      setSessionState(currentSessionState);
      
      // Store in sessionStorage for browser refresh recovery
      try {
        sessionStorage.setItem('videoChat_sessionState', JSON.stringify(currentSessionState));
      } catch (error) {
        console.warn('Failed to save session state to storage:', error);
      }
    }
  }, [connectionState, partnerId, roomId, isConnectionEstablished, isAudioMuted, isVideoDisabled]);

  // Attempt session restoration on component mount (Requirements 5.4, 5.5)
  useEffect(() => {
    if (isSessionRestored) {
      console.log('Session restoration requested - checking for previous state');
      
      // Try to restore from sessionStorage first
      try {
        const storedState = sessionStorage.getItem('videoChat_sessionState');
        if (storedState) {
          const parsedState = JSON.parse(storedState);
          
          // Check if stored state is recent (within last 10 minutes)
          const stateAge = Date.now() - (parsedState.lastConnectionTime || 0);
          if (stateAge < 10 * 60 * 1000) { // 10 minutes
            console.log('Found recent session state, attempting restoration');
            setSessionState(parsedState);
            
            // Restore media settings if available
            if (parsedState.mediaSettings) {
              setIsAudioMuted(parsedState.mediaSettings.audioMuted);
              setIsVideoDisabled(parsedState.mediaSettings.videoDisabled);
            }
            
            // Request session restoration from server
            socket.emit('request-session-restore');
            return;
          } else {
            console.log('Stored session state is too old, clearing');
            sessionStorage.removeItem('videoChat_sessionState');
          }
        }
      } catch (error) {
        console.warn('Failed to restore session state from storage:', error);
      }
      
      // Fallback to server-side session restoration
      socket.emit('request-session-restore');
    }
  }, [isSessionRestored, socket]);

  // Enhanced session restoration handler
  const handleSessionRestored = useCallback((data: { partnerId: string; roomId: string; wasReconnected: boolean }) => {
    console.log('Session restored successfully:', data);
    
    // Update connection state to show restoration in progress
    setConnectionState('connecting');
    onError('Session restored! Reconnecting to your partner...');
    
    // Apply restored session state
    if (sessionState.mediaSettings && localStreamRef.current) {
      // Restore audio/video settings
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      
      if (audioTrack) {
        audioTrack.enabled = !sessionState.mediaSettings.audioMuted;
        setIsAudioMuted(sessionState.mediaSettings.audioMuted);
      }
      
      if (videoTrack) {
        videoTrack.enabled = !sessionState.mediaSettings.videoDisabled;
        setIsVideoDisabled(sessionState.mediaSettings.videoDisabled);
      }
      
      console.log('Media settings restored:', sessionState.mediaSettings);
    }
    
    // Clear restoration message after successful reconnection
    setTimeout(() => {
      if (connectionState === 'connected') {
        onError('');
      }
    }, 3000);
    
  }, [sessionState, onError, connectionState]);

  const handleSessionRestoreFailed = useCallback((data: { reason: string }) => {
    console.log('Session restoration failed:', data.reason);
    onError(`Session restoration failed: ${data.reason}. Starting new session...`);
    
    // Clear stored session state since restoration failed
    try {
      sessionStorage.removeItem('videoChat_sessionState');
    } catch (error) {
      console.warn('Failed to clear session state:', error);
    }
    
    setSessionState({});
    
    // Clear error message after a delay
    setTimeout(() => {
      onError('');
    }, 3000);
  }, [onError]);

  // Network quality monitoring
  useEffect(() => {
    if (!peerConnectionRef.current || connectionState !== 'connected') return;

    // Start quality monitoring
    const monitor = new ConnectionQualityMonitor(
      peerConnectionRef.current,
      (quality) => {
        setNetworkQuality(quality);
        
        // Enable adaptive streaming if network quality is poor
        if (quality === 'poor' && !adaptiveStreamingEnabled) {
          console.log('Poor network quality detected, enabling adaptive streaming');
          setAdaptiveStreamingEnabled(true);
          adaptVideoQuality('low');
        } else if (quality === 'good' && adaptiveStreamingEnabled) {
          console.log('Network quality improved, disabling adaptive streaming');
          setAdaptiveStreamingEnabled(false);
          adaptVideoQuality('high');
        }
      }
    );

    qualityMonitorRef.current = monitor;
    monitor.start();

    return () => {
      monitor.stop();
      qualityMonitorRef.current = null;
    };
  }, [connectionState, adaptiveStreamingEnabled]);

  const adaptVideoQuality = async (quality: 'high' | 'medium' | 'low') => {
    if (!localStreamRef.current) return;

    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;

    try {
      let constraints;
      
      switch (quality) {
        case 'low':
          constraints = {
            width: { ideal: 320, max: 480 },
            height: { ideal: 240, max: 360 },
            frameRate: { ideal: 10, max: 15 }
          };
          break;
        case 'medium':
          constraints = {
            width: { ideal: 640, max: 854 },
            height: { ideal: 480, max: 480 },
            frameRate: { ideal: 15, max: 24 }
          };
          break;
        case 'high':
        default:
          constraints = {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 24, max: 30 }
          };
          break;
      }

      await videoTrack.applyConstraints(constraints);
      console.log(`Video quality adapted to ${quality}`);
      
    } catch (error) {
      console.error('Failed to adapt video quality:', error);
    }
  };
  // Network status monitoring for interruption recovery (Requirements 5.1, 5.3)
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [networkRecoveryInProgress, setNetworkRecoveryInProgress] = useState(false);

  // Enhanced heartbeat and network monitoring
  useEffect(() => {
    if (!socket) return;

    // Network status change handlers for interruption recovery (Requirements 5.1, 5.3)
    const handleOnline = () => {
      console.log('Network connection restored');
      setIsOnline(true);
      
      if (connectionState === 'connected' && peerConnectionRef.current) {
        // Network came back online - check if WebRTC connection needs recovery
        const rtcState = peerConnectionRef.current.connectionState;
        const iceState = peerConnectionRef.current.iceConnectionState;
        
        if (rtcState === 'disconnected' || rtcState === 'failed' || 
            iceState === 'disconnected' || iceState === 'failed') {
          console.log('Network recovered but WebRTC connection needs repair');
          setNetworkRecoveryInProgress(true);
          onError('Network connection restored. Reconnecting to your partner...');
          
          // Attempt connection recovery after network restoration
          setTimeout(() => {
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !isReconnecting) {
              attemptReconnection();
            }
            setNetworkRecoveryInProgress(false);
          }, 2000); // Give network a moment to stabilize
        }
      }
      
      // Send heartbeat to notify server we're back online
      if (socket.connected) {
        socket.emit('heartbeat', {
          networkRecovered: true,
          connectionQuality: networkQuality,
          isInActiveCall: connectionState === 'connected'
        });
      }
    };

    const handleOffline = () => {
      console.log('Network connection lost');
      setIsOnline(false);
      onError('Network connection lost. Waiting for connection to restore...');
    };

    // Send heartbeat every 30 seconds to detect browser close
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat', {
          isOnline: navigator.onLine,
          connectionQuality: networkQuality,
          isInActiveCall: connectionState === 'connected',
          timestamp: Date.now()
        });
      }
    }, 30000); // 30 seconds

    // Handle browser close/refresh events
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (socket.connected) {
        socket.emit('browser-closing');
      }
    };

    // Enhanced page visibility changes handling for connection persistence (Requirements 5.2)
    const handleVisibilityChange = () => {
      if (socket.connected) {
        const isVisible = !document.hidden;
        
        // Send enhanced heartbeat with visibility status
        socket.emit('heartbeat', {
          isVisible,
          connectionQuality: networkQuality,
          isInActiveCall: connectionState === 'connected'
        });
        
        // If tab becomes visible after being hidden, check connection health
        if (isVisible && connectionState === 'connected' && peerConnectionRef.current) {
          console.log('Tab became visible - checking connection health');
          
          // Check if WebRTC connection is still healthy
          const rtcConnectionState = peerConnectionRef.current.connectionState;
          const iceConnectionState = peerConnectionRef.current.iceConnectionState;
          
          if (rtcConnectionState === 'disconnected' || iceConnectionState === 'disconnected') {
            console.log('Connection degraded while tab was hidden - attempting recovery');
            // Don't immediately reconnect, let the grace period handle it
            setPartnerTemporarilyDisconnected(true);
            onError('Connection may have been affected by tab switching. Monitoring...');
            
            // Clear the message after a few seconds if connection recovers
            setTimeout(() => {
              if (peerConnectionRef.current && 
                  (peerConnectionRef.current.connectionState === 'connected' || 
                   peerConnectionRef.current.iceConnectionState === 'connected')) {
                setPartnerTemporarilyDisconnected(false);
                onError('');
              }
            }, 5000);
          }
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [socket]);

  const testNetworkConnectivity = async (): Promise<boolean> => {
    try {
      const connectivity = await testWebRTCConnectivity();
      console.log('Network connectivity test results:', connectivity);
      
      if (!connectivity.hasInternet) {
        return false;
      }
      
      if (!connectivity.hasSTUN) {
        console.warn('STUN connectivity failed - may have issues with NAT traversal');
      }
      
      if (!connectivity.hasTURN) {
        console.warn('TURN connectivity not available - may fail behind restrictive firewalls');
      }
      
      return connectivity.hasInternet;
    } catch (error) {
      console.error('Network connectivity test failed:', error);
      return false;
    }
  };

  const initializeVideoChat = async () => {
    try {
      setConnectionState('initializing');
      setMediaError(null);
      
      // Enhanced network connectivity testing with environment detection
      console.log('Testing network connectivity...');
      const connectivity = await testWebRTCConnectivity();
      
      console.log('Network connectivity test results:', connectivity);
      
      // Set network type and determine if we should force relay mode
      setNetworkType(connectivity.networkType);
      
      // Force relay mode for restrictive networks or high latency
      const shouldForceRelay = connectivity.networkType === 'restrictive' || 
                              connectivity.latency > 1000 ||
                              !connectivity.hasSTUN;
      
      setForceRelayMode(shouldForceRelay);
      
      if (shouldForceRelay) {
        console.log('🔒 Forcing relay mode due to restrictive network environment');
      }
      
      if (!connectivity.hasInternet) {
        console.warn('Network connectivity test failed, proceeding with caution');
        onError('Network connectivity issues detected. Connection may be unstable.');
      }
      
      if (!connectivity.hasTURN && connectivity.networkType === 'restrictive') {
        console.warn('⚠️ TURN connectivity not available in restrictive network - connections may be unstable');
      }
      
      if (!connectivity.hasSTUN) {
        console.warn('⚠️ STUN connectivity failed - NAT traversal may not work properly');
      }
      
      if (connectivity.latency > 1000) {
        console.warn(`⚠️ High network latency detected: ${connectivity.latency}ms - may affect call quality`);
      }
      
      // Get user media with fallback - this is critical
      console.log('Requesting camera and microphone access...');
      let stream: MediaStream;
      try {
        stream = await getMediaStreamWithFallback();
        localStreamRef.current = stream;
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        console.log('Media access successful:', {
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length
        });
      } catch (mediaError) {
        console.error('Failed to get media stream:', mediaError);
        setMediaError(mediaError instanceof Error ? mediaError.message : 'Failed to access camera/microphone');
        return; // Don't proceed without media
      }

      // Create peer connection with enhanced network traversal
      console.log('Creating WebRTC peer connection...');
      const peerConnection = await createPeerConnection(shouldForceRelay);
      peerConnectionRef.current = peerConnection;

      // Add local stream to peer connection
      console.log('Adding local stream to peer connection...');
      stream.getTracks().forEach((track, index) => {
        console.log(`Adding track ${index + 1}: ${track.kind} (${track.label})`);
        peerConnection.addTrack(track, stream);
      });

      setConnectionState('connecting');
      
      // Determine if this client should initiate the call
      // Use deterministic comparison to ensure only one side initiates
      const token = localStorage.getItem('authToken');
      let currentUserId = '';
      
      if (token) {
        try {
          // Decode JWT to get user ID (simple base64 decode of payload)
          const payload = JSON.parse(atob(token.split('.')[1]));
          currentUserId = payload.userId || '';
        } catch (error) {
          console.error('Failed to decode token:', error);
          currentUserId = socket.id || `fallback_${Date.now()}`; // Fallback to socket ID or generate one
        }
      } else {
        currentUserId = socket.id || `fallback_${Date.now()}`; // Fallback to socket ID or generate one
      }
      
      // Use string comparison for deterministic initiator selection
      const shouldInitiate = currentUserId.localeCompare(partnerId) < 0;
      setIsInitiator(shouldInitiate);
      
      console.log('Connection initiation logic:', {
        currentUserId,
        partnerId,
        roomId,
        shouldInitiate,
        comparison: `${currentUserId}.localeCompare(${partnerId}) = ${currentUserId.localeCompare(partnerId)} < 0 = ${shouldInitiate}`
      });
      
      if (shouldInitiate) {
        console.log('🚀 This client will initiate the connection');
        // Add delay to ensure both sides are ready and socket events are set up
        setTimeout(() => {
          // Double-check peer connection is still available before creating offer
          if (peerConnectionRef.current && peerConnectionRef.current.signalingState === 'stable') {
            console.log('Creating offer after delay...');
            createOffer();
          } else {
            console.log('⚠️ Peer connection not ready for offer creation, retrying...');
            // Retry after a short delay
            setTimeout(() => {
              if (peerConnectionRef.current && peerConnectionRef.current.signalingState === 'stable') {
                console.log('🔄 Retrying offer creation...');
                createOffer();
              }
            }, 1000);
          }
        }, 3000); // Increased delay to 3 seconds for better reliability
      } else {
        console.log('⏳ This client will wait for offer from partner');
        
        // Add a fallback timeout - if no offer is received within 15 seconds, create one anyway
        setTimeout(() => {
          if (peerConnectionRef.current && peerConnectionRef.current.signalingState === 'stable') {
            console.log('🔄 No offer received within 15s, creating offer as fallback');
            createOffer();
          }
        }, 15000); // Increased fallback timeout
      }

      // Set initial connection timeout only for setup phase
      const timeout = setTimeout(() => {
        if (!isConnectionEstablished && connectionState !== 'connected') {
          console.log('Initial connection timeout reached');
          handleInitialConnectionTimeout();
        }
      }, INITIAL_CONNECTION_TIMEOUT_CONST);
      setInitialConnectionTimeout(timeout);
      
    } catch (error) {
      console.error('Failed to initialize video chat:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize video chat';
      setMediaError(errorMessage);
      onError(errorMessage);
    }
  };

  const createPeerConnection = async (forceRelay: boolean = false): Promise<RTCPeerConnection> => {
    // Get enhanced WebRTC configuration with network traversal support
    const config = await getWebRTCConfiguration(forceRelay);
    
    console.log(`🔧 Creating peer connection with ${config.iceServers.length} ICE servers`);
    console.log(`🔧 ICE transport policy: ${config.iceTransportPolicy || 'all'}`);
    
    // Log TURN servers for debugging
    const turnServers = config.iceServers.filter(server => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some(url => url.startsWith('turn'));
    });
    
    console.log(`🔧 TURN servers configured: ${turnServers.length}`);
    turnServers.forEach((server, index) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      console.log(`   TURN ${index + 1}: ${urls[0]} (${server.username ? 'with credentials' : 'no credentials'})`);
    });
    
    if (forceRelay) {
      console.log('🔒 FORCED RELAY MODE: Only TURN servers will be used');
    }
    
    const peerConnection = new RTCPeerConnection(config);

    // Setup all event handlers
    setupPeerConnectionEventHandlers(peerConnection);

    return peerConnection;
  };

  const createOffer = async () => {
    if (!peerConnectionRef.current) {
      console.log('❌ Cannot create offer: peer connection not available');
      return;
    }

    // Check if we're in the right state to create an offer
    if (peerConnectionRef.current.signalingState !== 'stable') {
      console.log(`⚠️ Cannot create offer in signaling state: ${peerConnectionRef.current.signalingState}`);
      // Wait a bit and retry if we're in a transitional state
      if (peerConnectionRef.current.signalingState === 'have-remote-offer') {
        console.log('⏳ Waiting for answer to be processed before creating offer...');
        return; // Don't create offer if we have a remote offer
      }
      return;
    }

    try {
      console.log('📝 Creating WebRTC offer...');
      const offer = await peerConnectionRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: false // Don't restart ICE unless necessary
      });
      
      console.log('📝 Setting local description...');
      await peerConnectionRef.current.setLocalDescription(offer);
      
      // Wait a moment for ICE gathering to start
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('📤 Sending offer to partner via socket...');
      socket.emit('offer', offer);
      
      console.log('✅ Offer created and sent successfully');
      
      // Set a timeout for receiving an answer
      setTimeout(() => {
        if (peerConnectionRef.current && 
            peerConnectionRef.current.signalingState === 'have-local-offer' &&
            connectionState !== 'connected') {
          console.log('⏰ No answer received within 10s, may need to retry');
          // Don't automatically retry here, let the connection timeout handle it
        }
      }, 10000);
      
    } catch (error) {
      console.error('❌ Error creating offer:', error);
      onError('Failed to create connection offer. Retrying...');
      
      // Retry after exponential backoff delay (Requirements 4.2)
      const retryDelay = calculateExponentialBackoffDelay(1, 2000, 8000); // Start with 2s, max 8s for offer retries
      setTimeout(() => {
        if (peerConnectionRef.current && peerConnectionRef.current.signalingState === 'stable') {
          console.log('🔄 Retrying offer creation...');
          createOffer();
        }
      }, retryDelay);
    }
  };

  const handleReceiveOffer = useCallback(async (offer: RTCSessionDescriptionInit) => {
    if (!peerConnectionRef.current) {
      console.log('❌ Cannot handle offer: peer connection not available');
      return;
    }

    try {
      console.log('📨 Received offer from partner, setting remote description...');
      
      // Check if we already have a remote description
      if (peerConnectionRef.current.remoteDescription) {
        console.log('⚠️ Remote description already set');
        
        // Check if this is an ICE restart offer
        if (offer.sdp && offer.sdp.includes('a=ice-options:ice2')) {
          console.log('🔄 Detected ICE restart offer, processing...');
          // Allow ICE restart offers even if remote description exists
        } else {
          console.log('Ignoring duplicate offer (not ICE restart)');
          return;
        }
      }
      
      // Check signaling state
      if (peerConnectionRef.current.signalingState === 'have-local-offer') {
        console.log('⚠️ Received offer while we have local offer - handling collision');
        // Handle offer collision - the one with lower user ID should back off
        const token = localStorage.getItem('authToken');
        let currentUserId = '';
        
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            currentUserId = payload.userId || '';
          } catch (error) {
            currentUserId = socket.id || `fallback_${Date.now()}`;
          }
        } else {
          currentUserId = socket.id || `fallback_${Date.now()}`;
        }
        
        // If we have lower ID, we should back off and accept the offer
        if (currentUserId.localeCompare(partnerId) < 0) {
          console.log('🔄 Backing off from offer collision - accepting remote offer');
          // Reset to stable state first
          try {
            await peerConnectionRef.current.setLocalDescription({ type: 'rollback' });
          } catch (rollbackError) {
            console.warn('Rollback failed, continuing anyway:', rollbackError);
          }
        } else {
          console.log('⏳ Ignoring offer collision - keeping our offer');
          return;
        }
      }
      
      await peerConnectionRef.current.setRemoteDescription(offer);
      
      console.log('📝 Creating answer...');
      const answer = await peerConnectionRef.current.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      console.log('📝 Setting local description with answer...');
      await peerConnectionRef.current.setLocalDescription(answer);
      
      console.log('📤 Sending answer to partner...');
      socket.emit('answer', answer);
      console.log('✅ Answer created and sent successfully');
    } catch (error) {
      console.error('❌ Error handling offer:', error);
      
      // Don't retry ICE restart offers to avoid loops
      if (offer.sdp && offer.sdp.includes('a=ice-options:ice2')) {
        console.log('ICE restart offer failed, not retrying to avoid loops');
        return;
      }
      
      onError('Failed to handle connection offer. Retrying...');
      
      // Retry after exponential backoff delay
      const retryDelay = calculateExponentialBackoffDelay(1, 2000, 8000);
      setTimeout(() => {
        if (peerConnectionRef.current && offer && !peerConnectionRef.current.remoteDescription) {
          console.log('🔄 Retrying offer handling...');
          handleReceiveOffer(offer);
        }
      }, retryDelay);
    }
  }, [socket, onError, partnerId]);

  const handleReceiveAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (!peerConnectionRef.current) {
      console.log('❌ Cannot handle answer: peer connection not available');
      return;
    }

    try {
      console.log('📨 Received answer from partner, setting remote description...');
      
      // Check if we already have a remote description
      if (peerConnectionRef.current.remoteDescription) {
        console.log('⚠️ Remote description already set, ignoring duplicate answer');
        return;
      }
      
      // Ensure we're in the correct signaling state
      if (peerConnectionRef.current.signalingState !== 'have-local-offer') {
        console.log(`⚠️ Unexpected signaling state for answer: ${peerConnectionRef.current.signalingState}`);
        return;
      }
      
      await peerConnectionRef.current.setRemoteDescription(answer);
      console.log('✅ Answer received and set successfully');
    } catch (error) {
      console.error('❌ Error handling answer:', error);
      onError('Failed to handle connection answer. Retrying...');
      
      // Retry after exponential backoff delay (Requirements 4.2)
      const retryDelay = calculateExponentialBackoffDelay(1, 2000, 8000); // Start with 2s, max 8s for answer handling retries
      setTimeout(() => {
        if (peerConnectionRef.current && answer && !peerConnectionRef.current.remoteDescription) {
          console.log('🔄 Retrying answer handling...');
          handleReceiveAnswer(answer);
        }
      }, retryDelay);
    }
  }, [onError]);

  const handleReceiveIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!peerConnectionRef.current) return;

    try {
      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('ICE candidate added');
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
      // ICE candidate errors are usually not critical, so we don't show user error
    }
  }, []);

  const handleCallEnded = useCallback(() => {
    console.log('Call ended by partner');
    cleanup();
    onCallEnd();
  }, [onCallEnd]);

  const handlePartnerDisconnected = useCallback(() => {
    console.log('Partner disconnected');
    cleanup();
    onCallEnd();
  }, [onCallEnd]);

  const handlePartnerTimeout = useCallback(() => {
    console.log('Partner session timed out');
    cleanup();
    onError('Your chat partner\'s session timed out due to inactivity.');
    setTimeout(() => {
      onCallEnd();
    }, 2000);
  }, [onCallEnd, onError]);

  const handleSessionTimeout = useCallback(() => {
    console.log('Session timed out due to inactivity');
    cleanup();
    onError('Your session has timed out due to inactivity. Please refresh the page.');
  }, [onError]);

  const handlePartnerTemporarilyDisconnected = useCallback((data: { partnerId: string; reason: string }) => {
    console.log('Partner temporarily disconnected:', data);
    setPartnerTemporarilyDisconnected(true);
    onError(`Your chat partner temporarily disconnected (${data.reason}). Waiting for reconnection...`);
  }, [onError]);

  const handlePartnerReconnected = useCallback((data: { partnerId: string }) => {
    console.log('Partner reconnected:', data);
    setPartnerTemporarilyDisconnected(false);
    onError('Your chat partner has reconnected!');
    setTimeout(() => {
      // Clear the reconnection message after a few seconds
      if (connectionState === 'connected') {
        onError('');
      }
    }, 3000);
  }, [onError, connectionState]);

  const cleanup = () => {
    // Send browser closing event if socket is still connected (Requirements 8.1)
    if (socket && socket.connected) {
      socket.emit('browser-closing');
    }

    // Clear session state from storage when explicitly ending call (Requirements 5.5)
    try {
      sessionStorage.removeItem('videoChat_sessionState');
    } catch (error) {
      console.warn('Failed to clear session state:', error);
    }

    // Stop quality monitoring
    if (qualityMonitorRef.current) {
      qualityMonitorRef.current.stop();
      qualityMonitorRef.current = null;
    }

    // Stop network traversal monitoring
    if (networkTraversalMonitorRef.current) {
      networkTraversalMonitorRef.current = null;
    }

    // Clear all timeout timers to prevent memory leaks and conflicts (Requirements 3.5)
    clearAllTimeoutTimers();
    clearGraceTimers();

    // Clear initial connection timeout
    if (initialConnectionTimeout) {
      clearTimeout(initialConnectionTimeout);
      setInitialConnectionTimeout(null);
    }

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      localStreamRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Clear video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setConnectionState('disconnected');
    setIsConnectionEstablished(false);
    setIsReconnecting(false);
    setReconnectAttempts(0);
    setSessionState({}); // Clear session state
    setNetworkRecoveryInProgress(false);
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoDisabled(!videoTrack.enabled);
      }
    }
  };

  const endCall = () => {
    socket.emit('end-call');
    cleanup();
    onCallEnd();
  };

  const skipUser = () => {
    socket.emit('skip-user');
    cleanup();
    onCallEnd();
  };

  const reportUser = () => {
    setIsReportModalOpen(true);
  };

  const handleReportSubmit = async (category: string, description: string) => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        onError('Authentication required to submit report');
        return;
      }

      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          reportedUserId: partnerId,
          category,
          description,
          sessionId: roomId
        })
      });

      const data = await response.json();

      if (data.success) {
        console.log('Report submitted successfully:', data.data);
        
        // Emit report event to server for immediate session termination
        socket.emit('report-user', {
          reportedUserId: partnerId,
          category,
          description
        });

        // End the call immediately
        cleanup();
        onCallEnd();
      } else {
        onError(data.error || 'Failed to submit report');
      }
    } catch (error) {
      console.error('Error submitting report:', error);
      onError('Failed to submit report. Please try again.');
    }
  };

  const handleInitialConnectionTimeout = () => {
    console.log('Initial connection timeout - implementing progressive extension');
    
    // Only extend timeout during initial connection setup, not for established connections
    if (!isConnectionEstablished && connectionState === 'connecting' && reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST) {
      console.log('Connection still in progress, extending timeout...');
      // Implement exponential backoff for timeout extensions (Requirements 4.2)
      const extensionTime = calculateExponentialBackoffDelay(reconnectAttempts + 1, CONNECTION_SETUP_EXTENSION_CONST, MAX_RECONNECT_DELAY_CONST);
      
      console.log(`Extending timeout by ${extensionTime}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS_CONST})`);
      
      const extendedTimeout = setTimeout(() => {
        if (!isConnectionEstablished && peerConnectionRef.current && peerConnectionRef.current.connectionState !== 'connected') {
          console.log('Extended connection timeout reached');
          handleInitialConnectionTimeout();
        }
      }, extensionTime);
      setInitialConnectionTimeout(extendedTimeout);
      
      // Increment reconnect attempts for progressive extension
      setReconnectAttempts(prev => prev + 1);
    } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST) {
      attemptReconnection();
    } else {
      console.log('Max reconnection attempts reached during initial setup, showing error');
      // Improved error handling for maximum retry scenarios (Requirements 4.5)
      const errorMessage = `Connection timeout after ${MAX_RECONNECT_ATTEMPTS_CONST} attempts. This may be due to network issues or firewall restrictions. Please check your internet connection and try again.`;
      onError(errorMessage);
      setConnectionState('failed');
      
      // Provide recovery options to user
      setTimeout(() => {
        onError(`${errorMessage} You can try refreshing the page or checking your network settings.`);
      }, 3000);
    }
  };

  const handleConnectionLoss = () => {
    console.log('Connection lost - checking for reconnection');
    // Clear grace timers since we're now handling the connection loss
    clearGraceTimers();
    
    if (connectionState === 'connected' && reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST && !isReconnecting) {
      attemptReconnection();
    }
  };

  const handleConnectionFailure = () => {
    console.log('Connection failed - attempting recovery');
    // Clear grace timers since we're now handling the failure
    clearGraceTimers();
    
    // Only attempt reconnection if we haven't exceeded max attempts and not already reconnecting
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST && !isReconnecting) {
      console.log(`Connection failed, attempting reconnection ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS_CONST}`);
      attemptReconnection();
    } else if (!isReconnecting) {
      console.log('Max reconnection attempts reached after connection failure');
      setConnectionState('failed');
      
      // Enhanced error handling for maximum retry scenarios (Requirements 4.5)
      const errorMessage = `Connection failed after ${MAX_RECONNECT_ATTEMPTS_CONST} reconnection attempts. This could be due to:
      • Network connectivity issues
      • Firewall or NAT restrictions
      • Server overload
      
      Please check your internet connection and try again. If the problem persists, try refreshing the page.`;
      
      onError(errorMessage);
      
      // Provide additional recovery guidance after a delay
      setTimeout(() => {
        onError('You can also try connecting from a different network or contact support if issues continue.');
      }, 5000);
    }
  };

  const handleEnhancedICERestart = async () => {
    console.log('🔄 Handling enhanced ICE restart for network traversal...');
    
    if (!peerConnectionRef.current || isReconnecting) {
      console.log('Cannot perform ICE restart: peer connection unavailable or already reconnecting');
      return;
    }

    // Clear grace timers since we're handling the ICE failure
    clearGraceTimers();

    try {
      const currentAttempt = iceRestartAttempts + 1;
      setIceRestartAttempts(currentAttempt);
      
      console.log(`🔄 ICE restart attempt ${currentAttempt}/3`);
      
      // Check if peer connection is in stable state for ICE restart
      if (peerConnectionRef.current.signalingState !== 'stable') {
        console.log(`⚠️ Cannot restart ICE in signaling state: ${peerConnectionRef.current.signalingState}`);
        
        // Wait for stable state or fall back to full reconnection
        setTimeout(() => {
          if (peerConnectionRef.current?.signalingState === 'stable') {
            handleEnhancedICERestart();
          } else {
            console.log('Signaling state not stable, falling back to full reconnection');
            attemptReconnection();
          }
        }, 1000);
        return;
      }

      // Force relay mode for ICE restart if we're in a restrictive network
      const shouldForceRelay = networkType === 'restrictive' || currentAttempt > 1;
      
      if (shouldForceRelay && !forceRelayMode) {
        console.log('🔒 Forcing relay mode for ICE restart due to previous failures');
        setForceRelayMode(true);
        
        // Recreate peer connection with relay-only mode
        const newConfig = await getWebRTCConfiguration(true);
        const newPeerConnection = new RTCPeerConnection(newConfig);
        
        // Copy event handlers and tracks from old connection
        await recreatePeerConnectionWithRelayMode(newPeerConnection);
        return;
      }

      // Perform proper ICE restart using createOffer with iceRestart: true
      console.log('🔄 Creating ICE restart offer...');
      const offer = await peerConnectionRef.current.createOffer({
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      console.log('📝 Setting local description for ICE restart...');
      await peerConnectionRef.current.setLocalDescription(offer);
      
      // Send the ICE restart offer
      console.log('📤 Sending ICE restart offer...');
      socket.emit('offer', offer);
      
      console.log('✅ ICE restart initiated successfully');
      
      // Set timeout for ICE restart completion
      setTimeout(() => {
        if (peerConnectionRef.current && 
            (peerConnectionRef.current.iceConnectionState === 'failed' || 
             peerConnectionRef.current.iceConnectionState === 'disconnected')) {
          console.log('❌ ICE restart timeout - connection still failed');
          
          if (currentAttempt < 3) {
            handleEnhancedICERestart();
          } else {
            console.log('Max ICE restart attempts reached, falling back to full reconnection');
            attemptReconnection();
          }
        }
      }, 10000); // 10 second timeout for ICE restart
      
    } catch (error) {
      console.error('Enhanced ICE restart failed:', error);
      
      // Fall back to full reconnection with relay mode
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST) {
        console.log('ICE restart failed, falling back to full reconnection with relay mode');
        setForceRelayMode(true);
        attemptReconnection();
      } else {
        const errorMessage = `ICE restart and reconnection failed after multiple attempts.
        
        Error: ${error instanceof Error ? error.message : 'Unknown error'}
        
        Network type: ${networkType}
        Relay mode: ${forceRelayMode ? 'enabled' : 'disabled'}
        
        This indicates severe network restrictions. Please try:
        • Refreshing the page
        • Connecting from a different network (mobile data)
        • Disabling VPN if active
        • Using a different browser`;
        
        onError(errorMessage);
        handleConnectionFailure();
      }
    }
  };

  // Helper function to recreate peer connection with relay mode
  const recreatePeerConnectionWithRelayMode = async (newPeerConnection: RTCPeerConnection) => {
    console.log('🔄 Recreating peer connection with relay-only mode...');
    
    // Setup event handlers for new connection
    setupPeerConnectionEventHandlers(newPeerConnection);
    
    // Add local stream tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        newPeerConnection.addTrack(track, localStreamRef.current!);
      });
    }
    
    // Close old connection and replace
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    peerConnectionRef.current = newPeerConnection;
    
    // Create new offer with the relay-only connection
    if (isInitiator) {
      await createOffer();
    }
  };

  // Extract peer connection event handler setup into separate function
  const setupPeerConnectionEventHandlers = (peerConnection: RTCPeerConnection) => {
    // Setup enhanced network traversal monitoring
    networkTraversalMonitorRef.current = new NetworkTraversalMonitor(
      peerConnection,
      (state: string, details: any) => {
        console.log(`🔗 Network traversal event: ${state}`, details);
        
        switch (state) {
          case 'ice-connected':
            setLastStableConnection(Date.now());
            setIceRestartAttempts(0);
            break;
            
          case 'ice-disconnected':
            // Handle temporary disconnections common in restrictive networks
            if (details.timeSinceLastStable > 45000) { // 45 seconds
              console.log('🔄 Long disconnection detected - may need ICE restart');
            }
            break;
            
          case 'ice-restart-needed':
            handleEnhancedICERestart();
            break;
            
          case 'ice-failed-permanently':
            console.log('❌ ICE connection failed permanently after multiple restart attempts');
            handleConnectionFailure();
            break;
        }
      }
    );

    // Handle ICE candidates with enhanced logging and TURN verification
    let iceGatheringTimeout: NodeJS.Timeout | null = null;
    let iceCandidateCount = 0;
    let relayCandidateCount = 0;
    let srflxCandidateCount = 0;
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidateCount++;
        
        // Track different candidate types
        if (event.candidate.type === 'relay') {
          relayCandidateCount++;
          console.log(`🔄 TURN relay candidate found (${relayCandidateCount}):`, {
            address: event.candidate.address,
            port: event.candidate.port,
            protocol: event.candidate.protocol,
            relatedAddress: event.candidate.relatedAddress,
            relatedPort: event.candidate.relatedPort
          });
        } else if (event.candidate.type === 'srflx') {
          srflxCandidateCount++;
          console.log(`🌐 STUN srflx candidate found (${srflxCandidateCount}):`, {
            address: event.candidate.address,
            port: event.candidate.port
          });
        }
        
        console.log(`ICE candidate found (${iceCandidateCount}):`, {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          address: event.candidate.address,
          port: event.candidate.port,
          priority: event.candidate.priority
        });
        
        socket.emit('ice-candidate', event.candidate.toJSON());
      } else {
        console.log(`✅ ICE gathering completed: ${iceCandidateCount} total candidates`);
        console.log(`   - Relay (TURN): ${relayCandidateCount}`);
        console.log(`   - Server Reflexive (STUN): ${srflxCandidateCount}`);
        console.log(`   - Host: ${iceCandidateCount - relayCandidateCount - srflxCandidateCount}`);
        
        // Critical: Warn if no relay candidates in restrictive network or when forced
        if ((networkType === 'restrictive' || forceRelayMode) && relayCandidateCount === 0) {
          console.error('❌ CRITICAL: No TURN relay candidates found!');
          console.error('This will cause connection failures in restrictive networks.');
          console.error('Check TURN server configuration and credentials.');
          
          // Force a reconnection with different TURN servers if available
          if (iceRestartAttempts < 2) {
            console.log('🔄 Attempting ICE restart to gather TURN candidates...');
            setTimeout(() => handleEnhancedICERestart(), 2000);
          }
        }
        
        // Warn if only host candidates (no NAT traversal)
        if (relayCandidateCount === 0 && srflxCandidateCount === 0) {
          console.warn('⚠️ Only host candidates found - NAT traversal may fail');
        }
        
        if (iceGatheringTimeout) {
          clearTimeout(iceGatheringTimeout);
          iceGatheringTimeout = null;
        }
      }
    };

    // Enhanced ICE gathering state handling with TURN verification
    peerConnection.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', peerConnection.iceGatheringState);
      
      if (peerConnection.iceGatheringState === 'gathering') {
        // Longer timeout for restrictive networks to allow TURN candidates
        const timeout = (networkType === 'restrictive' || forceRelayMode) ? 25000 : ICE_GATHERING_TIMEOUT_CONST;
        
        console.log(`⏱️ ICE gathering timeout set to ${timeout}ms for network type: ${networkType}`);
        
        iceGatheringTimeout = setTimeout(() => {
          console.log(`⏰ ICE gathering timeout after ${timeout}ms`);
          console.log(`Final candidate count: ${iceCandidateCount} (${relayCandidateCount} relay, ${srflxCandidateCount} srflx)`);
          
          if (relayCandidateCount === 0 && (networkType === 'restrictive' || forceRelayMode)) {
            console.error('❌ TURN gathering failed - no relay candidates after timeout');
          }
        }, timeout);
      } else if (peerConnection.iceGatheringState === 'complete') {
        if (iceGatheringTimeout) {
          clearTimeout(iceGatheringTimeout);
          iceGatheringTimeout = null;
        }
      }
    };

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      console.log('Received remote stream with', event.streams[0].getTracks().length, 'tracks');
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // Handle connection state changes with detailed logging
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log('Connection state changed:', state);
      
      switch (state) {
        case 'connecting':
          console.log('WebRTC connection is being established...');
          clearGraceTimers();
          break;
        case 'connected':
          console.log('WebRTC connection established successfully');
          setConnectionState('connected');
          setIsConnectionEstablished(true);
          setReconnectAttempts(0);
          setIsReconnecting(false);
          setIceRestartAttempts(0); // Reset ICE restart attempts on successful connection
          clearAllTimeoutTimers();
          clearGraceTimers();
          if (initialConnectionTimeout) {
            clearTimeout(initialConnectionTimeout);
            setInitialConnectionTimeout(null);
          }
          break;
        case 'disconnected':
          console.log('WebRTC connection disconnected - implementing grace period');
          setConnectionState('disconnected');
          
          if (!disconnectionGraceTimer && !isReconnecting) {
            console.log(`Starting ${DISCONNECTION_GRACE_PERIOD_CONST}ms grace period for disconnection`);
            const graceTimer = setTimeout(() => {
              if (peerConnection.connectionState === 'disconnected') {
                console.log('Grace period expired, attempting ICE restart first');
                handleEnhancedICERestart(); // Try ICE restart before full reconnection
              }
              setDisconnectionGraceTimer(null);
            }, DISCONNECTION_GRACE_PERIOD_CONST);
            setDisconnectionGraceTimer(graceTimer);
          }
          break;
        case 'failed':
          console.log('WebRTC connection failed - implementing grace period before retry');
          setConnectionState('failed');
          
          if (!iceFailureGraceTimer && !isReconnecting) {
            console.log(`Starting ${ICE_FAILURE_GRACE_PERIOD_CONST}ms grace period for connection failure`);
            const graceTimer = setTimeout(() => {
              if (peerConnection.connectionState === 'failed') {
                console.log('Grace period expired, attempting ICE restart');
                handleEnhancedICERestart(); // Try ICE restart before full reconnection
              }
              setIceFailureGraceTimer(null);
            }, ICE_FAILURE_GRACE_PERIOD_CONST);
            setIceFailureGraceTimer(graceTimer);
          }
          break;
        case 'closed':
          console.log('WebRTC connection closed');
          setConnectionState('disconnected');
          clearGraceTimers();
          break;
      }
    };

    // Handle ICE connection state changes with enhanced retry logic
    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;
      console.log('ICE connection state:', iceState);
      
      switch (iceState) {
        case 'checking':
          console.log('ICE connectivity checks are in progress...');
          clearGraceTimers();
          break;
        case 'connected':
          console.log('ICE connectivity checks succeeded');
          setLastStableConnection(Date.now());
          clearGraceTimers();
          break;
        case 'completed':
          console.log('ICE connectivity checks completed successfully');
          setLastStableConnection(Date.now());
          clearGraceTimers();
          break;
        case 'failed':
          console.log('ICE connectivity checks failed - implementing enhanced retry logic');
          
          if (!iceFailureGraceTimer && !isReconnecting) {
            console.log(`Starting ${ICE_FAILURE_GRACE_PERIOD_CONST}ms grace period for ICE failure`);
            const graceTimer = setTimeout(() => {
              if (peerConnection.iceConnectionState === 'failed') {
                console.log('ICE failure grace period expired, attempting enhanced ICE restart');
                handleEnhancedICERestart();
              }
              setIceFailureGraceTimer(null);
            }, ICE_FAILURE_GRACE_PERIOD_CONST);
            setIceFailureGraceTimer(graceTimer);
          }
          break;
        case 'disconnected':
          console.log('ICE connection disconnected - implementing grace period');
          
          if (!disconnectionGraceTimer && !isReconnecting) {
            console.log(`Starting ${DISCONNECTION_GRACE_PERIOD_CONST}ms grace period for ICE disconnection`);
            const graceTimer = setTimeout(() => {
              if (peerConnection.iceConnectionState === 'disconnected') {
                console.log('ICE disconnection grace period expired, attempting ICE restart');
                handleEnhancedICERestart(); // Try ICE restart first
              }
              setDisconnectionGraceTimer(null);
            }, DISCONNECTION_GRACE_PERIOD_CONST);
            setDisconnectionGraceTimer(graceTimer);
          }
          break;
        case 'closed':
          console.log('ICE connection closed');
          setConnectionState('disconnected');
          clearGraceTimers();
          break;
      }
    };

    // Handle signaling state changes
    peerConnection.onsignalingstatechange = () => {
      console.log('Signaling state:', peerConnection.signalingState);
    };

    // Handle data channel errors
    peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      channel.onerror = (error) => {
        console.error('Data channel error:', error);
      };
    };
  };

  const attemptReconnection = async () => {
    if (isReconnecting) {
      console.log('Reconnection already in progress, skipping duplicate attempt');
      return;
    }

    setIsReconnecting(true);
    const currentAttempt = reconnectAttempts + 1;
    setReconnectAttempts(currentAttempt);
    
    // Clear any existing grace timers and timeout timers to prevent conflicts
    clearGraceTimers();
    clearAllTimeoutTimers();
    
    console.log(`Attempting reconnection ${currentAttempt}/${MAX_RECONNECT_ATTEMPTS}`);

    // Implement proper exponential backoff with reasonable maximum delays
    const delay = calculateExponentialBackoffDelay(currentAttempt);
    
    console.log(`Exponential backoff: attempt=${currentAttempt}, delay=${delay}ms (max=${MAX_RECONNECT_DELAY_CONST}ms)`);

    // Wait before attempting reconnection
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // Force relay mode after first failure in restrictive networks
      const shouldForceRelay = forceRelayMode || 
                              networkType === 'restrictive' || 
                              currentAttempt > 1;
      
      if (shouldForceRelay && !forceRelayMode) {
        console.log('🔒 Enabling relay mode for reconnection attempt');
        setForceRelayMode(true);
      }

      // Close existing peer connection
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      // Create new peer connection with enhanced error handling and network traversal
      const newPeerConnection = await createPeerConnection(shouldForceRelay);
      peerConnectionRef.current = newPeerConnection;

      // Re-add local stream if available, otherwise try to get media again
      if (localStreamRef.current && localStreamRef.current.active) {
        localStreamRef.current.getTracks().forEach(track => {
          if (track.readyState === 'live') {
            newPeerConnection.addTrack(track, localStreamRef.current!);
          }
        });
      } else {
        console.log('Local stream not available, attempting to get media again');
        try {
          const stream = await getMediaStreamWithFallback();
          localStreamRef.current = stream;
          
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }

          stream.getTracks().forEach(track => {
            newPeerConnection.addTrack(track, stream);
          });
        } catch (mediaError) {
          console.error('Failed to get media during reconnection:', mediaError);
          // Continue with reconnection attempt even without media
        }
      }

      setConnectionState('connecting');

      // Restart the connection process
      if (isInitiator) {
        await createOffer();
      }

      // Set timeout only for initial connection setup, not for established connection monitoring
      if (!isConnectionEstablished && activeTimeoutTimers.size === 0) {
        // Use exponential backoff for timeout duration as well
        const baseTimeout = INITIAL_CONNECTION_TIMEOUT_CONST;
        const extensionMultiplier = calculateExponentialBackoffDelay(currentAttempt, CONNECTION_SETUP_EXTENSION_CONST, MAX_RECONNECT_DELAY_CONST);
        const timeoutDuration = Math.min(baseTimeout + extensionMultiplier, baseTimeout + MAX_RECONNECT_DELAY_CONST);
        
        console.log(`Setting reconnection timeout: ${timeoutDuration}ms for attempt ${currentAttempt}`);
        
        const timeout = setTimeout(() => {
          if (!isConnectionEstablished && connectionState !== 'connected') {
            console.log(`Reconnection attempt ${currentAttempt} timed out`);
            removeTimeoutTimer(timeout);
            handleInitialConnectionTimeout();
          }
        }, timeoutDuration);
        setInitialConnectionTimeout(timeout);
        addTimeoutTimer(timeout);
      } else if (isConnectionEstablished) {
        console.log('Connection was previously established - no timeout for reconnection attempts');
      } else {
        console.log('Timeout timer already active, skipping duplicate timer creation');
      }

    } catch (error) {
      console.error(`Reconnection attempt ${currentAttempt} failed:`, error);
      setIsReconnecting(false);
      
      if (currentAttempt >= MAX_RECONNECT_ATTEMPTS_CONST) {
        // Enhanced error handling for maximum retry scenarios
        const detailedError = `Unable to reconnect after ${MAX_RECONNECT_ATTEMPTS_CONST} attempts. 
        
        Last error: ${error instanceof Error ? error.message : 'Unknown error'}
        Network type: ${networkType}
        Relay mode: ${forceRelayMode ? 'enabled' : 'disabled'}
        
        This typically indicates:
        • Severe network restrictions (firewall/NAT)
        • TURN server connectivity issues
        • Partner disconnected
        
        Solutions to try:
        • Refresh the page and try again
        • Switch to mobile data if on WiFi
        • Try a different browser
        • Disable VPN if active
        • Contact support if issues persist`;
        
        onError(detailedError);
        setConnectionState('failed');
      } else {
        // Schedule next attempt with exponential backoff
        const nextDelay = calculateExponentialBackoffDelay(currentAttempt + 1);
        console.log(`Scheduling next reconnection attempt in ${nextDelay}ms`);
        setTimeout(() => attemptReconnection(), nextDelay);
      }
    }
  };

  const retryConnection = () => {
    setReconnectAttempts(0);
    setIsReconnecting(false);
    setIsConnectionEstablished(false); // Reset connection establishment flag
    setMediaError(null);
    initializeVideoChat();
  };

  const getConnectionStatusText = () => {
    if (partnerTemporarilyDisconnected) {
      return 'Partner temporarily disconnected - waiting for reconnection...';
    }
    
    if (networkRecoveryInProgress) {
      return 'Network recovered - reconnecting to partner...';
    }
    
    if (!isOnline) {
      return 'Network connection lost - waiting for network...';
    }
    
    if (isReconnecting) {
      return `Reconnecting... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS_CONST})`;
    }
    
    if (isSessionRestored && connectionState === 'initializing') {
      return 'Restoring previous session...';
    }
    
    let baseStatus = '';
    switch (connectionState) {
      case 'initializing':
        return 'Setting up camera and microphone...';
      case 'connecting':
        return 'Connecting to your partner...';
      case 'connected':
        baseStatus = partnerTemporarilyDisconnected ? 'Partner reconnected!' : 'Connected';
        break;
      case 'disconnected':
        return reconnectAttempts > 0 ? 'Connection lost' : 'Disconnected';
      case 'failed':
        return 'Connection failed';
      default:
        return 'Unknown status';
    }
    
    // Add network quality indicator for connected state
    if (connectionState === 'connected') {
      const qualityText = networkQuality === 'good' ? '🟢' : networkQuality === 'fair' ? '🟡' : '🔴';
      const adaptiveText = adaptiveStreamingEnabled ? ' (Adaptive)' : '';
      const offlineText = !isOnline ? ' (Offline)' : '';
      return `${baseStatus} ${qualityText}${adaptiveText}${offlineText}`;
    }
    
    return baseStatus;
  };

  const getConnectionStatusColor = () => {
    if (partnerTemporarilyDisconnected) {
      return 'text-yellow-600';
    }
    
    if (networkRecoveryInProgress) {
      return 'text-blue-600';
    }
    
    if (!isOnline) {
      return 'text-red-600';
    }
    
    if (isReconnecting) {
      return 'text-yellow-600';
    }
    
    if (isSessionRestored && connectionState === 'initializing') {
      return 'text-blue-600';
    }
    
    switch (connectionState) {
      case 'initializing':
      case 'connecting':
        return 'text-yellow-600';
      case 'connected':
        return 'text-green-600';
      case 'disconnected':
      case 'failed':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Report Modal */}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        onSubmit={handleReportSubmit}
        partnerInfo={{
          id: partnerId,
          roomId: roomId
        }}
      />

      {/* Header */}
      <header className="bg-gray-800 text-white p-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-semibold">Video Chat</h1>
            <p className={`text-sm ${getConnectionStatusColor()}`}>
              {getConnectionStatusText()}
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-300">
              Room: {roomId.slice(0, 8)}...
            </div>
          </div>
        </div>
      </header>

      {/* Video Container */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-6xl w-full">
          {mediaError ? (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded text-center">
              <h3 className="font-semibold mb-2">Media Access Error</h3>
              <p>{mediaError}</p>
              <div className="mt-4 space-x-2">
                <button
                  onClick={retryConnection}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                >
                  Retry Connection
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors"
                >
                  Refresh Page
                </button>
              </div>
            </div>
          ) : connectionState === 'failed' && !isReconnecting ? (
            <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded text-center">
              <h3 className="font-semibold mb-2">Connection Failed</h3>
              <p>Unable to establish video connection with your partner.</p>
              <div className="mt-4 space-x-2">
                <button
                  onClick={retryConnection}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={endCall}
                  className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors"
                >
                  End Call
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
              {/* Remote Video (Partner) */}
              <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                  Partner
                </div>
                {(connectionState !== 'connected' || isReconnecting) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-700 bg-opacity-75">
                    <div className="text-center text-white">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                      <p className="text-sm">
                        {isReconnecting 
                          ? `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS_CONST})`
                          : 'Waiting for partner...'
                        }
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Local Video (You) */}
              <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video">
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                  You
                </div>
                
                {/* Network Status Indicators */}
                <div className="absolute top-4 right-4 z-20">
                  <div className="flex flex-col gap-2">
                    {/* Network Type Indicator */}
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      networkType === 'open' ? 'bg-green-100 text-green-800' :
                      networkType === 'moderate' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      Network: {networkType}
                    </div>
                    
                    {/* Relay Mode Indicator */}
                    {forceRelayMode && (
                      <div className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800">
                        🔒 Relay Mode
                      </div>
                    )}
                    
                    {/* ICE Restart Attempts */}
                    {iceRestartAttempts > 0 && (
                      <div className="px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-800">
                        ICE Restarts: {iceRestartAttempts}
                      </div>
                    )}
                    
                    {/* Connection Quality */}
                    <div className={`px-2 py-1 rounded text-xs font-medium ${
                      networkQuality === 'good' ? 'bg-green-100 text-green-800' :
                      networkQuality === 'fair' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {networkQuality === 'good' ? '📶 Good' :
                       networkQuality === 'fair' ? '📶 Fair' : '📶 Poor'}
                    </div>
                  </div>
                </div>
                
                {isVideoDisabled && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-700">
                    <div className="text-center text-white">
                      <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center mx-auto mb-2">
                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <p className="text-sm">Camera disabled</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 p-4">
        <div className="max-w-6xl mx-auto flex justify-center items-center space-x-4">
          {/* Audio Toggle */}
          <button
            onClick={toggleAudio}
            disabled={!localStreamRef.current}
            className={`p-3 rounded-full transition-colors ${
              isAudioMuted
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-gray-600 hover:bg-gray-700 text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={isAudioMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              {isAudioMuted ? (
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
              ) : (
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM15.657 6.343a1 1 0 011.414 0c.28.28.5.599.653.943a5.002 5.002 0 010 5.428 3.9 3.9 0 01-.653.943 1 1 0 01-1.414-1.414c.159-.159.296-.327.406-.506a3.002 3.002 0 000-3.472c-.11-.179-.247-.347-.406-.506a1 1 0 010-1.414z" clipRule="evenodd" />
              )}
            </svg>
          </button>

          {/* Video Toggle */}
          <button
            onClick={toggleVideo}
            disabled={!localStreamRef.current}
            className={`p-3 rounded-full transition-colors ${
              isVideoDisabled
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-gray-600 hover:bg-gray-700 text-white'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={isVideoDisabled ? 'Enable camera' : 'Disable camera'}
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              {isVideoDisabled ? (
                <path d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A2 2 0 0018 13V7a2 2 0 00-2-2h-5.586l-.707-.707A1 1 0 009 4H6a2 2 0 00-2 2v.586L3.707 2.293zM6 8.586V6h3l1 1h6v6.586l-2-2V9a1 1 0 00-1.707-.707L6 14.586V8.586z" />
              ) : (
                <path d="M4 6a2 2 0 012-2h6l2 2h2a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM6 8a2 2 0 114 0 2 2 0 01-4 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z" />
              )}
            </svg>
          </button>

          {/* End Call */}
          <button
            onClick={endCall}
            className="p-3 rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors"
            title="End call"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Skip User */}
          <button
            onClick={skipUser}
            className="p-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            title="Skip to next user"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Report User (placeholder for task 7.2) */}
          <button
            onClick={reportUser}
            className="p-3 rounded-full bg-yellow-600 hover:bg-yellow-700 text-white transition-colors"
            title="Report user"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}