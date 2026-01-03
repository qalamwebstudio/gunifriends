'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '../types';
import ReportModal from './ReportModal';
import { getWebRTCConfiguration, testWebRTCConnectivity, getMediaStreamWithFallback, ConnectionQualityMonitor } from '../lib/webrtc-config';

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
  const [connectionTimeout, setConnectionTimeout] = useState<NodeJS.Timeout | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [partnerTemporarilyDisconnected, setPartnerTemporarilyDisconnected] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<'good' | 'fair' | 'poor'>('good');
  const [adaptiveStreamingEnabled, setAdaptiveStreamingEnabled] = useState(false);

  // Constants for error handling and retry logic
  const MAX_RECONNECT_ATTEMPTS = 3;
  const CONNECTION_TIMEOUT_MS = 45000; // Increased to 45s for better WebRTC setup
  const INITIAL_RECONNECT_DELAY_MS = 2000;
  const MAX_RECONNECT_DELAY_MS = 10000;
  const ICE_GATHERING_TIMEOUT_MS = 12000; // Increased to 12s for better ICE gathering

  // WebRTC configuration with STUN/TURN servers for NAT traversal
  const rtcConfiguration = getWebRTCConfiguration();

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
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
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
      socket.off('error');
    };
  }, [socket]);

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
  useEffect(() => {
    if (!socket) return;

    // Send heartbeat every 30 seconds to detect browser close
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat');
      }
    }, 30000); // 30 seconds

    // Handle browser close/refresh events
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (socket.connected) {
        socket.emit('browser-closing');
      }
    };

    // Handle page visibility changes (browser tab switching, minimizing)
    const handleVisibilityChange = () => {
      if (socket.connected) {
        socket.emit('heartbeat');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
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
      
      // Test network connectivity first
      console.log('Testing network connectivity...');
      const hasConnectivity = await testNetworkConnectivity();
      
      if (!hasConnectivity) {
        console.warn('Network connectivity test failed, proceeding with caution');
        onError('Network connectivity issues detected. Connection may be unstable.');
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

      // Create peer connection
      console.log('Creating WebRTC peer connection...');
      const peerConnection = createPeerConnection();
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

      // Set connection timeout with more reasonable duration
      const timeout = setTimeout(() => {
        if (connectionState !== 'connected') {
          console.log('Connection timeout reached');
          handleConnectionTimeout();
        }
      }, CONNECTION_TIMEOUT_MS);
      setConnectionTimeout(timeout);
      
    } catch (error) {
      console.error('Failed to initialize video chat:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize video chat';
      setMediaError(errorMessage);
      onError(errorMessage);
    }
  };

  const createPeerConnection = (): RTCPeerConnection => {
    const peerConnection = new RTCPeerConnection(rtcConfiguration);

    // Handle ICE candidates with timeout
    let iceGatheringTimeout: NodeJS.Timeout | null = null;
    let iceCandidateCount = 0;
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidateCount++;
        console.log(`ICE candidate found (${iceCandidateCount}):`, event.candidate.type, event.candidate.protocol);
        socket.emit('ice-candidate', event.candidate.toJSON());
      } else {
        console.log(`ICE gathering completed with ${iceCandidateCount} candidates`);
        if (iceGatheringTimeout) {
          clearTimeout(iceGatheringTimeout);
          iceGatheringTimeout = null;
        }
      }
    };

    // Set ICE gathering timeout with more aggressive settings
    peerConnection.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', peerConnection.iceGatheringState);
      
      if (peerConnection.iceGatheringState === 'gathering') {
        // Longer timeout for better ICE candidate collection
        iceGatheringTimeout = setTimeout(() => {
          console.log(`ICE gathering timeout - proceeding with ${iceCandidateCount} candidates`);
          // Don't fail the connection, just proceed with what we have
        }, ICE_GATHERING_TIMEOUT_MS);
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
          break;
        case 'connected':
          console.log('WebRTC connection established successfully');
          setConnectionState('connected');
          setReconnectAttempts(0);
          setIsReconnecting(false);
          // Clear connection timeout on successful connection
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            setConnectionTimeout(null);
          }
          break;
        case 'disconnected':
          console.log('WebRTC connection disconnected');
          setConnectionState('disconnected');
          handleConnectionLoss();
          break;
        case 'failed':
          console.log('WebRTC connection failed');
          setConnectionState('failed');
          // Don't immediately fail - try to recover
          setTimeout(() => {
            if (peerConnectionRef.current && peerConnectionRef.current.connectionState === 'failed') {
              handleConnectionFailure();
            }
          }, 3000); // Give it 3 seconds to potentially recover
          break;
        case 'closed':
          console.log('WebRTC connection closed');
          setConnectionState('disconnected');
          break;
      }
    };

    // Handle ICE connection state changes with detailed logging
    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;
      console.log('ICE connection state:', iceState);
      
      switch (iceState) {
        case 'checking':
          console.log('ICE connectivity checks are in progress...');
          break;
        case 'connected':
          console.log('ICE connectivity checks succeeded');
          break;
        case 'completed':
          console.log('ICE connectivity checks completed successfully');
          break;
        case 'failed':
          console.log('ICE connectivity checks failed');
          // Give it a moment before failing - sometimes it recovers
          setTimeout(() => {
            if (peerConnection.iceConnectionState === 'failed') {
              handleConnectionFailure();
            }
          }, 2000);
          break;
        case 'disconnected':
          console.log('ICE connection disconnected');
          // Don't immediately fail - might reconnect
          setTimeout(() => {
            if (peerConnection.iceConnectionState === 'disconnected') {
              handleConnectionLoss();
            }
          }, 3000);
          break;
        case 'closed':
          console.log('ICE connection closed');
          setConnectionState('disconnected');
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
      
      // Retry after a short delay
      setTimeout(() => {
        if (peerConnectionRef.current && peerConnectionRef.current.signalingState === 'stable') {
          console.log('🔄 Retrying offer creation...');
          createOffer();
        }
      }, 2000);
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
        console.log('⚠️ Remote description already set, ignoring duplicate offer');
        return;
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
          await peerConnectionRef.current.setLocalDescription({ type: 'rollback' });
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
      onError('Failed to handle connection offer. Retrying...');
      
      // Retry after a short delay
      setTimeout(() => {
        if (peerConnectionRef.current && offer && !peerConnectionRef.current.remoteDescription) {
          console.log('🔄 Retrying offer handling...');
          handleReceiveOffer(offer);
        }
      }, 2000);
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
      
      // Retry after a short delay
      setTimeout(() => {
        if (peerConnectionRef.current && answer && !peerConnectionRef.current.remoteDescription) {
          console.log('🔄 Retrying answer handling...');
          handleReceiveAnswer(answer);
        }
      }, 2000);
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

    // Stop quality monitoring
    if (qualityMonitorRef.current) {
      qualityMonitorRef.current.stop();
      qualityMonitorRef.current = null;
    }

    // Clear connection timeout
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      setConnectionTimeout(null);
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
    setIsReconnecting(false);
    setReconnectAttempts(0);
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

  const handleConnectionTimeout = () => {
    console.log('Connection timeout - attempting to reconnect');
    
    // Don't immediately fail if we're still in connecting state
    if (connectionState === 'connecting' && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      console.log('Connection still in progress, extending timeout...');
      // Extend timeout by another 15 seconds
      const extendedTimeout = setTimeout(() => {
        if (peerConnectionRef.current && peerConnectionRef.current.connectionState !== 'connected') {
          console.log('Extended connection timeout reached');
          attemptReconnection();
        }
      }, 15000);
      setConnectionTimeout(extendedTimeout);
    } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      attemptReconnection();
    } else {
      console.log('Max reconnection attempts reached, showing error');
      onError('Connection timeout. Unable to establish video connection after multiple attempts.');
      setConnectionState('failed');
    }
  };

  const handleConnectionLoss = () => {
    console.log('Connection lost - checking for reconnection');
    if (connectionState === 'connected' && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      attemptReconnection();
    }
  };

  const handleConnectionFailure = () => {
    console.log('Connection failed - attempting recovery');
    
    // Only attempt reconnection if we haven't exceeded max attempts
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      console.log(`Connection failed, attempting reconnection ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS}`);
      attemptReconnection();
    } else {
      console.log('Max reconnection attempts reached after connection failure');
      setConnectionState('failed');
      onError('Connection failed after multiple attempts. Please check your network connection and try again.');
    }
  };

  const attemptReconnection = async () => {
    if (isReconnecting) return;

    setIsReconnecting(true);
    const currentAttempt = reconnectAttempts + 1;
    setReconnectAttempts(currentAttempt);
    
    console.log(`Attempting reconnection ${currentAttempt}/${MAX_RECONNECT_ATTEMPTS}`);

    // Calculate exponential backoff delay
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, currentAttempt - 1),
      MAX_RECONNECT_DELAY_MS
    );
    
    console.log(`Waiting ${delay}ms before reconnection attempt`);

    // Wait before attempting reconnection
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // Close existing peer connection
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      // Create new peer connection with enhanced error handling
      const newPeerConnection = createPeerConnection();
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

      // Set new connection timeout with longer duration for reconnection attempts
      const timeoutDuration = CONNECTION_TIMEOUT_MS + (currentAttempt * 5000); // Add 5s per attempt
      const timeout = setTimeout(() => {
        if (connectionState !== 'connected') {
          console.log(`Reconnection attempt ${currentAttempt} timed out`);
          handleConnectionTimeout();
        }
      }, timeoutDuration);
      setConnectionTimeout(timeout);

    } catch (error) {
      console.error(`Reconnection attempt ${currentAttempt} failed:`, error);
      setIsReconnecting(false);
      
      if (currentAttempt >= MAX_RECONNECT_ATTEMPTS) {
        onError('Unable to reconnect after multiple attempts. Please refresh the page and try again.');
        setConnectionState('failed');
      } else {
        // Schedule next attempt
        console.log(`Scheduling reconnection attempt ${currentAttempt + 1}`);
        setTimeout(() => attemptReconnection(), 1000);
      }
    }
  };

  const retryConnection = () => {
    setReconnectAttempts(0);
    setIsReconnecting(false);
    setMediaError(null);
    initializeVideoChat();
  };

  const getConnectionStatusText = () => {
    if (partnerTemporarilyDisconnected) {
      return 'Partner temporarily disconnected - waiting for reconnection...';
    }
    
    if (isReconnecting) {
      return `Reconnecting... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;
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
      return `${baseStatus} ${qualityText}${adaptiveText}`;
    }
    
    return baseStatus;
  };

  const getConnectionStatusColor = () => {
    if (partnerTemporarilyDisconnected) {
      return 'text-yellow-600';
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
                          ? `Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
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