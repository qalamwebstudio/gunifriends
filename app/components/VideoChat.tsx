'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import Image from 'next/image';
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
  WebRTCManager,
  registerTimeout,
  registerInterval,
  registerAbortController,
  registerNetworkProbe,
  isReconnectionBlocked,
  isLatencyHandlerBlocked,
  isVisibilityChangeHandlerBlocked,
  isICERestartBlocked,
  shouldBlockReconnectionOperation,
  isPeerConnectionRecreationBlocked,
  isPeerConnectionModificationBlocked,
  createProtectedPeerConnection,
  protectedCreateOffer,
  protectedCreateAnswer,
  protectedSetLocalDescription,
  protectedSetRemoteDescription,
  protectedAddTrack,
  protectedRemoveTrack,
  protectedRestartIce,
  protectedClose,
  safeGetStats,
  shouldRestrictQualityAdaptation
} from '../lib/webrtc-manager';
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

type ConnectionState = 'idle' | 'matched' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'ended';
type ConnectionPhase = 'pre-connection' | 'post-connection';

export default function VideoChat({ socket, partnerId, roomId, onCallEnd, onError, isSessionRestored = false }: VideoChatProps) {
  // Video element refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // WebRTC refs
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const qualityMonitorRef = useRef<ConnectionQualityMonitor | null>(null);

  // State
  const [connectionState, setConnectionState] = useState<ConnectionState>('matched');
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>('pre-connection');
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

  // Session timer state
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [sessionDuration, setSessionDuration] = useState<number>(0);

  // Parallel execution state for optimized initialization
  const [mediaReady, setMediaReady] = useState(false);
  const [uiReady, setUIReady] = useState(false);
  const [connectionReady, setConnectionReady] = useState(false);
  const [networkOptimized, setNetworkOptimized] = useState(false);

  // Performance monitoring state for timing metrics (Requirements: 1.2)
  const [performanceMetrics, setPerformanceMetrics] = useState<{
    initializationStartTime: number | null;
    timeToFirstFrame: number | null;
    timeToUIReady: number | null;
    timeToConnectionReady: number | null;
    timeToFullyOptimized: number | null;
  }>({
    initializationStartTime: null,
    timeToFirstFrame: null,
    timeToUIReady: null,
    timeToConnectionReady: null,
    timeToFullyOptimized: null,
  });

  // Performance monitoring effect for development alerts
  useEffect(() => {
    if (!performanceMetrics.initializationStartTime) return;

    // Set up periodic performance monitoring during initialization
    const monitoringInterval = setInterval(() => {
      // Only monitor during active initialization (before fully optimized)
      if (!networkOptimized) {
        detectPerformanceDegradation();
      } else {
        // Clear interval once fully optimized
        clearInterval(monitoringInterval);
      }
    }, 1000); // Check every second during initialization

    return () => {
      clearInterval(monitoringInterval);
    };
  }, [performanceMetrics.initializationStartTime, networkOptimized]);

  // Session timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (connectionState === 'connected' && sessionStartTime) {
      interval = setInterval(() => {
        const now = new Date();
        const duration = Math.floor((now.getTime() - sessionStartTime.getTime()) / 1000);
        setSessionDuration(duration);
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [connectionState, sessionStartTime]);

  // Start session timer when connection is established
  useEffect(() => {
    if (connectionState === 'connected' && !sessionStartTime) {
      setSessionStartTime(new Date());
    }
  }, [connectionState, sessionStartTime]);

  // Format session duration as MM:SS
  const formatSessionDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Enhanced WebRTC network traversal state - FROZEN after connection
  const [networkType, setNetworkType] = useState<'open' | 'moderate' | 'restrictive'>('open');
  const [forceRelayMode, setForceRelayMode] = useState(false);
  const [iceRestartAttempts, setIceRestartAttempts] = useState(0);
  const [lastStableConnection, setLastStableConnection] = useState(0);
  const networkTraversalMonitorRef = useRef<any>(null);
  const [networkDetectionFrozen, setNetworkDetectionFrozen] = useState(false);

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

  // Helper function to freeze network detection after successful connection
  const freezeNetworkDetection = useCallback(() => {
    if (!networkDetectionFrozen) {
      console.log('🔒 FREEZING network detection - connection established successfully');
      setNetworkDetectionFrozen(true);
      setConnectionPhase('post-connection');

      // Cancel all connection timeouts immediately
      clearAllTimeoutTimers();
      clearGraceTimers();

      if (initialConnectionTimeout) {
        clearTimeout(initialConnectionTimeout);
        setInitialConnectionTimeout(null);
      }

      console.log('✅ All pre-connection timeouts and detection logic disabled');
    }
  }, [networkDetectionFrozen, initialConnectionTimeout]);

  // Helper function to check if we should run pre-connection logic
  const shouldRunPreConnectionLogic = useCallback(() => {
    return connectionPhase === 'pre-connection' && !networkDetectionFrozen;
  }, [connectionPhase, networkDetectionFrozen]);

  // Helper functions for parallel execution state
  const isUserInterfaceReady = () => mediaReady && uiReady;
  const isConnectionReady = () => connectionReady;
  const isFullyOptimized = () => networkOptimized;

  // Performance monitoring functions (Requirements: 1.2)
  const startPerformanceMonitoring = () => {
    const startTime = performance.now();
    setPerformanceMetrics(prev => ({
      ...prev,
      initializationStartTime: startTime,
      timeToFirstFrame: null,
      timeToUIReady: null,
      timeToConnectionReady: null,
      timeToFullyOptimized: null,
    }));
    console.log('📊 PERFORMANCE: Started timing metrics monitoring');
    return startTime;
  };

  const recordTimeToFirstFrame = () => {
    if (performanceMetrics.initializationStartTime) {
      const timeToFirstFrame = performance.now() - performanceMetrics.initializationStartTime;
      setPerformanceMetrics(prev => ({
        ...prev,
        timeToFirstFrame
      }));

      console.log(`📊 PERFORMANCE: Time-to-first-frame: ${timeToFirstFrame.toFixed(2)}ms`);

      // Log performance warning if target exceeded (Requirements: 1.2)
      if (timeToFirstFrame > 500) {
        console.warn(`⚠️ PERFORMANCE WARNING: Time-to-first-frame (${timeToFirstFrame.toFixed(2)}ms) exceeded target of 500ms`);
        if (process.env.NODE_ENV === 'development') {
          console.warn('🚨 PERFORMANCE ALERT: Time-to-first-frame target exceeded - check for blocking operations');
        }
      } else {
        console.log(`✅ PERFORMANCE: Time-to-first-frame target met (${timeToFirstFrame.toFixed(2)}ms < 500ms)`);
      }

      return timeToFirstFrame;
    }
    return null;
  };

  const recordTimeToUIReady = () => {
    if (performanceMetrics.initializationStartTime) {
      const timeToUIReady = performance.now() - performanceMetrics.initializationStartTime;
      setPerformanceMetrics(prev => ({
        ...prev,
        timeToUIReady
      }));

      console.log(`📊 PERFORMANCE: Time-to-UI-ready: ${timeToUIReady.toFixed(2)}ms`);

      // Log performance warning if significantly delayed
      if (timeToUIReady > 1000) {
        console.warn(`⚠️ PERFORMANCE WARNING: Time-to-UI-ready (${timeToUIReady.toFixed(2)}ms) is high - UI should be ready quickly`);
      }

      return timeToUIReady;
    }
    return null;
  };

  const recordTimeToConnectionReady = () => {
    if (performanceMetrics.initializationStartTime) {
      const timeToConnectionReady = performance.now() - performanceMetrics.initializationStartTime;
      setPerformanceMetrics(prev => ({
        ...prev,
        timeToConnectionReady
      }));

      console.log(`📊 PERFORMANCE: Time-to-connection-ready: ${timeToConnectionReady.toFixed(2)}ms`);

      // Log performance warning if target exceeded
      if (timeToConnectionReady > 3000) {
        console.warn(`⚠️ PERFORMANCE WARNING: Time-to-connection-ready (${timeToConnectionReady.toFixed(2)}ms) exceeded target of 3000ms`);
      }

      return timeToConnectionReady;
    }
    return null;
  };

  const recordTimeToFullyOptimized = () => {
    if (performanceMetrics.initializationStartTime) {
      const timeToFullyOptimized = performance.now() - performanceMetrics.initializationStartTime;
      setPerformanceMetrics(prev => ({
        ...prev,
        timeToFullyOptimized
      }));

      console.log(`📊 PERFORMANCE: Time-to-fully-optimized: ${timeToFullyOptimized.toFixed(2)}ms`);

      // Log complete performance summary
      console.log('📊 PERFORMANCE SUMMARY:', {
        timeToFirstFrame: performanceMetrics.timeToFirstFrame?.toFixed(2) + 'ms',
        timeToUIReady: performanceMetrics.timeToUIReady?.toFixed(2) + 'ms',
        timeToConnectionReady: performanceMetrics.timeToConnectionReady?.toFixed(2) + 'ms',
        timeToFullyOptimized: timeToFullyOptimized.toFixed(2) + 'ms'
      });

      // Detect performance degradation patterns
      detectPerformanceDegradation();

      return timeToFullyOptimized;
    }
    return null;
  };

  // Development-mode performance alerts and monitoring
  const detectBlockingOperations = (operationName: string, startTime: number, threshold: number = 100) => {
    const duration = performance.now() - startTime;

    if (duration > threshold) {
      console.warn(`⚠️ BLOCKING OPERATION DETECTED: ${operationName} took ${duration.toFixed(2)}ms (threshold: ${threshold}ms)`);

      if (process.env.NODE_ENV === 'development') {
        console.warn(`🚨 PERFORMANCE ALERT: Blocking operation "${operationName}" may impact initialization performance`);
        console.warn('Consider making this operation asynchronous or moving it to background stream');
      }

      return true;
    }

    return false;
  };

  const detectPerformanceDegradation = () => {
    if (!performanceMetrics.initializationStartTime) return;

    const currentTime = performance.now();
    const totalTime = currentTime - performanceMetrics.initializationStartTime;

    // Check for performance degradation patterns
    const degradationIssues: string[] = [];

    // Check if time-to-first-frame is significantly delayed
    if (performanceMetrics.timeToFirstFrame && performanceMetrics.timeToFirstFrame > 1000) {
      degradationIssues.push(`Time-to-first-frame severely delayed: ${performanceMetrics.timeToFirstFrame.toFixed(2)}ms`);
    }

    // Check if UI setup is taking too long relative to media access
    if (performanceMetrics.timeToUIReady && performanceMetrics.timeToFirstFrame) {
      const uiSetupTime = performanceMetrics.timeToUIReady - performanceMetrics.timeToFirstFrame;
      if (uiSetupTime > 200) {
        degradationIssues.push(`UI setup taking too long: ${uiSetupTime.toFixed(2)}ms after first frame`);
      }
    }

    // Check if connection setup is taking too long
    if (performanceMetrics.timeToConnectionReady && performanceMetrics.timeToConnectionReady > 5000) {
      degradationIssues.push(`Connection setup severely delayed: ${performanceMetrics.timeToConnectionReady.toFixed(2)}ms`);
    }

    // Check if total initialization time is excessive
    if (totalTime > 10000) {
      degradationIssues.push(`Total initialization time excessive: ${totalTime.toFixed(2)}ms`);
    }

    if (degradationIssues.length > 0) {
      console.warn('⚠️ PERFORMANCE DEGRADATION DETECTED:');
      degradationIssues.forEach(issue => console.warn(`   - ${issue}`));

      if (process.env.NODE_ENV === 'development') {
        console.warn('🚨 PERFORMANCE ALERT: Performance degradation detected during initialization');
        console.warn('Check for blocking operations, network issues, or execution order violations');
      }
    }
  };

  const logExecutionOrderViolationAlert = (step: string, violations: string[]) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`🚨 EXECUTION ORDER VIOLATION ALERT in ${step}:`);
      violations.forEach(violation => {
        console.warn(`   🔴 ${violation}`);
      });
      console.warn('This may cause blocking operations and impact time-to-first-frame performance');
      console.warn('Ensure proper execution order: Media Access → UI Setup → Peer Connection → Network Detection (parallel)');
    }
  };

  // Helper functions for timeout management (Requirements 3.5)
  const addTimeoutTimer = (timer: NodeJS.Timeout) => {
    setActiveTimeoutTimers(prev => {
      const newSet = new Set(prev);
      newSet.add(timer);
      return newSet;
    });
  };

  const removeTimeoutTimer = (timer: NodeJS.Timeout) => {
    setActiveTimeoutTimers(prev => {
      const newSet = new Set(prev);
      newSet.delete(timer);
      return newSet;
    });
  };

  const clearAllTimeoutTimers = () => {
    const timers = Array.from(activeTimeoutTimers);
    timers.forEach(timer => clearTimeout(timer));
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

  // Initialize media stream and WebRTC connection with parallel stream coordination
  useEffect(() => {
    let isMounted = true;
    let immediateUIController: AbortController | null = null;
    let connectionController: AbortController | null = null;
    let backgroundController: AbortController | null = null;

    const coordinateParallelStreams = async () => {
      try {
        console.log('🚀 COORDINATION: Starting parallel stream coordination');

        // Start performance monitoring (Requirements: 1.2)
        startPerformanceMonitoring();

        // Reset execution order state for new initialization
        setExecutionOrder({
          mediaAccessStarted: false,
          mediaAccessCompleted: false,
          uiSetupStarted: false,
          uiSetupCompleted: false,
          peerConnectionStarted: false,
          peerConnectionCompleted: false,
          networkDetectionStarted: false,
          networkDetectionCompleted: false,
        });

        // Keep 'matched' state initially to show "Setting up camera and microphone..."
        // Will change to 'connecting' after media is ready
        setConnectionPhase('pre-connection');
        setNetworkDetectionFrozen(false);
        setMediaError(null);

        // Reset parallel execution state
        setMediaReady(false);
        setUIReady(false);
        setConnectionReady(false);
        setNetworkOptimized(false);

        // Create abort controllers for each stream
        immediateUIController = new AbortController();
        connectionController = new AbortController();
        backgroundController = new AbortController();

        console.log('🚀 COORDINATION: Launching parallel streams concurrently');

        // Stream 1: Immediate UI Stream (target: <500ms) - highest priority
        const immediateUIPromise = initializeImmediateUIStream(immediateUIController.signal);

        // Stream 3: Background Optimization Stream (non-blocking) - lowest priority
        const backgroundOptimizationPromise = initializeBackgroundOptimizationStream(backgroundController.signal);

        // Wait for media access to complete before starting connection stream
        let localStream: MediaStream | null = null;
        try {
          localStream = await immediateUIPromise;

          if (!isMounted) {
            console.log('🚀 COORDINATION: Component unmounted during immediate UI stream');
            return;
          }

          if (!localStream) {
            throw new Error('Failed to get media stream');
          }

          console.log('✅ COORDINATION: Immediate UI stream completed successfully');

          // Now that media is ready, change to connecting state
          setConnectionState('connecting');
        } catch (error) {
          if (!isMounted) return;

          console.error('❌ COORDINATION: Immediate UI stream failed:', error);
          const errorMessage = error instanceof Error ? error.message : 'Failed to access camera/microphone';
          setMediaError(errorMessage);
          onError(errorMessage);
          return; // Don't proceed without media
        }

        // Stream 2: Connection Stream (starts after media is ready) - medium priority
        const connectionStreamPromise = initializeConnectionStreamCoordinated(localStream, connectionController.signal);

        // Handle connection stream completion independently
        connectionStreamPromise
          .then(() => {
            if (!isMounted) return;
            console.log('✅ COORDINATION: Connection stream completed successfully');
          })
          .catch((error) => {
            if (!isMounted) return;
            console.error('❌ COORDINATION: Connection stream failed:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to initialize connection';
            setMediaError(errorMessage);
            onError(errorMessage);
          });

        // Handle background optimization completion independently (non-critical)
        backgroundOptimizationPromise
          .then(() => {
            if (!isMounted) return;
            console.log('✅ COORDINATION: Background optimization stream completed');
          })
          .catch((error) => {
            if (!isMounted) return;
            console.warn('🔍 COORDINATION: Background optimization failed (non-critical):', error);
            // Don't show user error for background optimization failures
          });

        // Set initial connection timeout ONLY during pre-connection phase
        // CRITICAL FIX: Only trigger timeout if ICE connection actually fails, not based on time elapsed
        if (shouldRunPreConnectionLogic() && !WebRTCManager.getCallIsConnected()) {
          const timeout = registerTimeout(() => {
            if (isMounted && !isConnectionEstablished && connectionState !== 'connected') {
              // CRITICAL: Check ICE state before triggering timeout - only fail if ICE is actually failed
              const iceState = peerConnectionRef.current?.iceConnectionState;
              if (iceState === 'failed') {
                console.log('Initial connection timeout reached with ICE failure - triggering reconnection');
                handleInitialConnectionTimeout();
              } else {
                console.log(`Initial connection timeout reached but ICE state is "${iceState}" - extending timeout to allow ICE completion`);
                // Extend timeout to allow ICE negotiation to complete naturally
                const extendedTimeout = registerTimeout(() => {
                  const currentIceState = peerConnectionRef.current?.iceConnectionState;
                  if (currentIceState === 'failed') {
                    console.log('Extended timeout reached with ICE failure - triggering reconnection');
                    handleInitialConnectionTimeout();
                  } else {
                    console.log(`Extended timeout reached but ICE state is "${currentIceState}" - allowing connection to continue`);
                  }
                }, 30000, 'Extended ICE completion timeout'); // 30s extension for ICE completion

                if (extendedTimeout) {
                  setInitialConnectionTimeout(extendedTimeout);
                }
              }
            }
          }, INITIAL_CONNECTION_TIMEOUT_CONST, 'Initial connection timeout (coordinated)');

          if (timeout) {
            setInitialConnectionTimeout(timeout);
          } else {
            console.log('⏭️ Initial connection timeout blocked - connection already established');
          }
        } else {
          console.log('⏭️ Skipping initial connection timeout - connection established or pre-connection logic blocked');
        }

        console.log('🎉 COORDINATION: Parallel stream coordination setup complete');
        console.log('📊 COORDINATION: Stream status - UI Ready:', isUserInterfaceReady(), 'Connection Ready:', isConnectionReady());

      } catch (error) {
        if (!isMounted) return;

        console.error('❌ COORDINATION: Failed to coordinate parallel streams:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to initialize video chat';
        setMediaError(errorMessage);
        onError(errorMessage);
      }
    };

    // Start coordination
    coordinateParallelStreams();

    // Cleanup function
    return () => {
      console.log('🧹 COORDINATION: Cleaning up parallel streams');
      isMounted = false;

      // Final performance check on cleanup
      if (performanceMetrics.initializationStartTime && process.env.NODE_ENV === 'development') {
        const totalTime = performance.now() - performanceMetrics.initializationStartTime;
        if (!networkOptimized && totalTime > 5000) {
          console.warn('🚨 PERFORMANCE ALERT: Component unmounted before initialization completed');
          console.warn(`Total time before cleanup: ${totalTime.toFixed(2)}ms`);
          console.warn('This may indicate blocking operations or execution order issues');
        }
      }

      // Abort all ongoing streams
      if (immediateUIController && !immediateUIController.signal.aborted) {
        console.log('🧹 COORDINATION: Aborting immediate UI stream');
        immediateUIController.abort();
      }

      if (connectionController && !connectionController.signal.aborted) {
        console.log('🧹 COORDINATION: Aborting connection stream');
        connectionController.abort();
      }

      if (backgroundController && !backgroundController.signal.aborted) {
        console.log('🧹 COORDINATION: Aborting background optimization stream');
        backgroundController.abort();
      }

      // Perform main cleanup
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
        const recoveryTimeout = registerTimeout(() => {
          // CRITICAL: Block reconnection attempts when CALL_IS_CONNECTED = true
          // Requirements: 1.5, 3.5 - Prevent reconnection logic after connection
          if (shouldBlockReconnectionOperation('Socket error recovery')) {
            console.log('🚫 Socket error recovery blocked - connection is established');
            return;
          }

          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST) {
            console.log('Attempting to recover from partner session error...');
            attemptReconnection();
          } else {
            console.log('Max recovery attempts reached, ending call');
            onError('Unable to establish connection with partner. Please try again.');
            const endCallTimeout = registerTimeout(() => onCallEnd(), 3000, 'End call timeout after max recovery attempts');
            if (!endCallTimeout) {
              onCallEnd(); // Call immediately if timeout is blocked
            }
          }
        }, 2000, 'Partner session error recovery timeout');

        if (!recoveryTimeout) {
          console.log('⏭️ Partner session recovery timeout blocked - connection already established');
        }
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
    const clearMessageTimeout = registerTimeout(() => {
      if (connectionState === 'connected') {
        onError('');
      }
    }, 3000, 'Clear session restoration message timeout');

    if (!clearMessageTimeout) {
      console.log('⏭️ Clear restoration message timeout blocked - connection already established');
    }

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
    const clearErrorTimeout = registerTimeout(() => {
      onError('');
    }, 3000, 'Clear session restore failed message timeout');

    if (!clearErrorTimeout) {
      console.log('⏭️ Clear error message timeout blocked - connection already established');
    }
  }, [onError]);

  // Network quality monitoring - ONLY use WebRTC stats after connection
  useEffect(() => {
    if (!peerConnectionRef.current || connectionState !== 'connected') return;

    // Start quality monitoring ONLY with WebRTC stats, no network probing
    const monitor = new ConnectionQualityMonitor(
      peerConnectionRef.current,
      (quality) => {
        setNetworkQuality(quality);

        // Enable adaptive streaming if network quality is poor
        // Use ONLY sender parameter changes, NOT PeerConnection recreation
        // CRITICAL: Block latency spike handlers when CALL_IS_CONNECTED = true
        // Requirements: 1.5, 4.3 - Prevent latency spike handlers from triggering reconnection
        if (quality === 'poor' && !adaptiveStreamingEnabled) {
          if (isLatencyHandlerBlocked()) {
            console.log('🚫 Latency spike handler blocked - connection is established, using quality adaptation only');
            // Still allow quality adaptation, just block reconnection
            setAdaptiveStreamingEnabled(true);
            adaptVideoQuality('low');
          } else {
            console.log('Poor network quality detected, enabling adaptive streaming');
            setAdaptiveStreamingEnabled(true);
            adaptVideoQuality('low');
          }
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

      // ONLY attempt recovery if we're in post-connection phase AND have actual WebRTC failure
      // CRITICAL: Block network recovery handlers when CALL_IS_CONNECTED = true
      // Requirements: 1.5, 4.3 - Prevent network handlers from triggering reconnection
      if (connectionState === 'connected' && peerConnectionRef.current && networkDetectionFrozen) {
        // Check if network recovery handler should be blocked
        if (shouldBlockReconnectionOperation('Network recovery handler')) {
          console.log('🚫 Network recovery handler blocked - connection is established');
          return;
        }

        // Network came back online - check if WebRTC connection needs recovery
        const rtcState = peerConnectionRef.current.connectionState;
        const iceState = peerConnectionRef.current.iceConnectionState;

        if (rtcState === 'failed' || iceState === 'failed') {
          console.log('Network recovered and WebRTC connection needs repair');
          setNetworkRecoveryInProgress(true);
          onError('Network connection restored. Reconnecting to your partner...');

          // Attempt connection recovery after network restoration
          const recoveryTimeout = registerTimeout(() => {
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !isReconnecting) {
              attemptReconnection();
            }
            setNetworkRecoveryInProgress(false);
          }, 2000, 'Network recovery timeout'); // Give network a moment to stabilize

          if (!recoveryTimeout) {
            console.log('⏭️ Network recovery timeout blocked - connection already established');
            setNetworkRecoveryInProgress(false);
          }
        } else {
          console.log('Network recovered but WebRTC connection is stable - no action needed');
        }
      } else if (shouldRunPreConnectionLogic()) {
        console.log('Network recovered during pre-connection phase');
        // Let normal connection establishment handle this
      } else {
        console.log('Network recovered but connection is stable - ignoring');
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
    // Requirements 2.1 - Block interval creation when connected
    const heartbeatInterval = registerInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat', {
          isOnline: navigator.onLine,
          connectionQuality: networkQuality,
          isInActiveCall: connectionState === 'connected',
          timestamp: Date.now()
        });
      }
    }, 30000, 'Heartbeat interval'); // 30 seconds

    if (!heartbeatInterval) {
      console.log('⏭️ Heartbeat interval blocked - connection already established');
    }

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
        // BUT ONLY if we're in post-connection phase and have actual WebRTC failure
        // CRITICAL: Block visibility change handlers when CALL_IS_CONNECTED = true
        // Requirements: 4.4 - Block visibility change handlers from reconnecting
        if (isVisible && connectionState === 'connected' && peerConnectionRef.current && networkDetectionFrozen) {
          console.log('Tab became visible - checking connection health');

          // Check if visibility change handler should be blocked
          if (isVisibilityChangeHandlerBlocked()) {
            console.log('🚫 Visibility change reconnection handler blocked - connection is established');
            return;
          }

          // Check if WebRTC connection is actually failed (not just disconnected)
          const rtcConnectionState = peerConnectionRef.current.connectionState;
          const iceConnectionState = peerConnectionRef.current.iceConnectionState;

          if (rtcConnectionState === 'failed' || iceConnectionState === 'failed') {
            console.log('Connection actually failed while tab was hidden - attempting recovery');
            setPartnerTemporarilyDisconnected(true);
            onError('Connection failed while tab was hidden. Attempting to reconnect...');

            // Attempt recovery only for actual failures
            const visibilityRecoveryTimeout = registerTimeout(() => {
              if (peerConnectionRef.current &&
                (peerConnectionRef.current.connectionState === 'failed' ||
                  peerConnectionRef.current.iceConnectionState === 'failed')) {
                handleEnhancedICERestart();
              } else {
                setPartnerTemporarilyDisconnected(false);
                onError('');
              }
            }, 2000, 'Visibility change recovery timeout');

            if (!visibilityRecoveryTimeout) {
              console.log('⏭️ Visibility recovery timeout blocked - connection already established');
              setPartnerTemporarilyDisconnected(false);
              onError('');
            }
          } else if (rtcConnectionState === 'disconnected' || iceConnectionState === 'disconnected') {
            console.log('Connection temporarily disconnected while tab was hidden - monitoring');
            // Just monitor, don't immediately reconnect
            const monitoringTimeout = registerTimeout(() => {
              if (peerConnectionRef.current &&
                (peerConnectionRef.current.connectionState === 'connected' ||
                  peerConnectionRef.current.iceConnectionState === 'connected')) {
                console.log('Connection recovered naturally after tab visibility change');
              }
            }, 5000, 'Visibility change monitoring timeout');

            if (!monitoringTimeout) {
              console.log('⏭️ Visibility monitoring timeout blocked - connection already established');
            }
          } else {
            console.log('Connection is stable after tab visibility change - no action needed');
          }
        } else if (shouldRunPreConnectionLogic()) {
          console.log('Tab visibility changed during pre-connection phase - normal behavior');
        } else {
          console.log('Tab visibility changed but network detection frozen - ignoring');
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
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

  // Immediate UI Stream - Fast media access and preview (target: <500ms)
  const initializeImmediateUI = async (): Promise<MediaStream | null> => {
    try {
      console.log('🎥 IMMEDIATE: Starting immediate UI stream');
      setMediaError(null);

      // Start media access immediately - no waiting
      console.log('🎥 IMMEDIATE: Requesting camera access');
      const stream = await getMediaStreamWithFallback();

      // Attach to video element immediately
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log('✅ IMMEDIATE: Local preview displayed');
      }

      // Store stream reference
      localStreamRef.current = stream;

      // Enable UI controls immediately
      setUIReady(true);
      setMediaReady(true);

      console.log('✅ IMMEDIATE: UI stream complete - videoTracks=' + stream.getVideoTracks().length + ', audioTracks=' + stream.getAudioTracks().length);
      return stream;
    } catch (error) {
      // Show error immediately, don't wait for network detection
      const errorMessage = getMediaAccessErrorMessage(error);
      console.error('❌ IMMEDIATE: Media access failed:', errorMessage);
      setMediaError(errorMessage);
      throw error;
    }
  };

  // Helper function to provide clear user guidance for media access errors
  const getMediaAccessErrorMessage = (error: any): string => {
    const baseError = error instanceof Error ? error.message : 'Failed to access camera/microphone';

    // Provide specific guidance based on error type
    if (baseError.includes('Permission denied') || baseError.includes('NotAllowedError')) {
      return 'Camera/microphone access denied. Please click the camera icon in your browser\'s address bar and allow access, then try again.';
    }

    if (baseError.includes('NotFoundError') || baseError.includes('DeviceNotFoundError')) {
      return 'No camera or microphone found. Please connect a camera/microphone and refresh the page.';
    }

    if (baseError.includes('NotReadableError') || baseError.includes('TrackStartError')) {
      return 'Camera/microphone is being used by another application. Please close other video apps and try again.';
    }

    if (baseError.includes('OverconstrainedError') || baseError.includes('ConstraintNotSatisfiedError')) {
      return 'Camera/microphone doesn\'t support required settings. Try refreshing the page or using a different device.';
    }

    if (baseError.includes('NotSupportedError')) {
      return 'Your browser doesn\'t support camera/microphone access. Please use a modern browser like Chrome, Firefox, or Safari.';
    }

    if (baseError.includes('AbortError')) {
      return 'Camera/microphone access was interrupted. Please try again.';
    }

    // Generic error with helpful suggestions
    return `${baseError}. Try refreshing the page, checking your camera/microphone permissions, or using a different browser.`;
  };

  // Connection Stream - Default WebRTC configuration and signaling
  const initializeConnectionStream = async (localStream: MediaStream): Promise<void> => {
    try {
      console.log('🔗 CONNECTION: Starting connection stream');

      // Use default WebRTC config immediately - don't wait for network detection
      console.log('🔗 CONNECTION: Creating peer connection with default config');
      const peerConnection = await createPeerConnection(false); // Use default config, not forced relay

      if (!peerConnection) {
        console.error('❌ CONNECTION: Failed to create peer connection');
        throw new Error('Failed to create peer connection');
      }

      peerConnectionRef.current = peerConnection;
      console.log('🔗 CONNECTION: PeerConnection created successfully');

      // Add tracks immediately
      console.log('🔗 CONNECTION: Adding local tracks to PeerConnection');
      localStream.getTracks().forEach((track, index) => {
        console.log('🔗 CONNECTION: Adding track ' + (index + 1) + ' - ' + track.kind + ' (' + track.label + ')');

        const sender = protectedAddTrack(peerConnection, track, localStream);

        if (!sender) {
          console.error('❌ CONNECTION: addTrack() blocked - connection is already established');
        }
      });

      // Setup event handlers
      setupPeerConnectionEventHandlers(peerConnection);

      // Determine initiator and begin signaling immediately if ready
      const token = localStorage.getItem('authToken');
      let currentUserId = '';

      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          currentUserId = payload.userId || '';
        } catch (error) {
          console.error('Failed to decode token:', error);
          currentUserId = socket.id || `fallback_${Date.now()}`;
        }
      } else {
        currentUserId = socket.id || `fallback_${Date.now()}`;
      }

      const shouldInitiate = currentUserId.localeCompare(partnerId) < 0;
      setIsInitiator(shouldInitiate);

      console.log('🔗 CONNECTION: Initiation logic:', {
        currentUserId,
        partnerId,
        shouldInitiate
      });

      // Begin signaling immediately when both peers are ready - no artificial delays
      if (shouldInitiate) {
        console.log('🚀 CONNECTION: This client will initiate - creating offer immediately');
        // No artificial 3-second delay
        if (peerConnection.signalingState === 'stable') {
          createOffer();
        } else {
          // Wait briefly for stable state, then create offer
          const stableStateCheck = registerTimeout(() => {
            if (peerConnectionRef.current && peerConnectionRef.current.signalingState === 'stable') {
              createOffer();
            }
          }, 100, 'Stable state check for offer creation');

          if (!stableStateCheck) {
            console.log('⏭️ Stable state check timeout blocked - connection established');
          }
        }
      } else {
        console.log('⏳ CONNECTION: This client will wait for offer from partner');
        // No artificial 15-second fallback timeout during normal operation
      }

      setConnectionReady(true);
      console.log('✅ CONNECTION: Connection stream complete');

    } catch (error) {
      console.error('❌ CONNECTION: Connection stream failed:', error);
      throw error;
    }
  };

  // Background Optimization Stream - Network detection and configuration enhancement
  const initializeBackgroundOptimization = async (): Promise<void> => {
    // Start network detection without blocking UI or connection
    console.log('🔍 BACKGROUND: Starting background optimization stream');

    // Only run during pre-connection phase
    if (!shouldRunPreConnectionLogic() || WebRTCManager.getCallIsConnected()) {
      console.log('⏭️ BACKGROUND: Skipping network detection - connection established or blocked');
      setNetworkOptimized(true);
      return;
    }

    try {
      // Start network detection and STUN/TURN probing without blocking
      // Use Promise-based approach instead of blocking await operations
      console.log('🔍 BACKGROUND: Starting parallel network detection and STUN/TURN probing');

      const networkDetectionPromise = testWebRTCConnectivity().catch(error => {
        console.warn('🔍 BACKGROUND: Network connectivity test failed (non-critical):', error);
        // Return default connectivity result on failure
        return {
          networkType: 'open',
          hasInternet: true,
          hasSTUN: true,
          hasTURN: false,
          latency: 0,
          fallbackUsed: true
        };
      });

      const stunTurnProbePromise = import('../lib/turn-test').then(({ testAllTURNServers }) =>
        testAllTURNServers().catch(error => {
          console.warn('🔍 BACKGROUND: STUN/TURN probing failed (non-critical):', error);
          return [];
        })
      );

      // Don't await - let these run in background with 2-second timeout fallback
      const timeoutPromise = new Promise<any>((resolve) => {
        const timeoutHandle = registerTimeout(() => {
          console.log('🔍 BACKGROUND: Network detection timeout - using defaults (graceful fallback)');
          resolve({
            networkType: 'open',
            hasInternet: true,
            hasSTUN: true,
            hasTURN: false,
            latency: 0,
            timedOut: true,
            turnResults: []
          });
        }, 2000, 'Background optimization timeout'); // 2-second timeout fallback to default configuration

        if (!timeoutHandle) {
          console.log('⏭️ BACKGROUND: Network detection timeout blocked - connection established');
          resolve({
            networkType: 'open',
            hasInternet: true,
            hasSTUN: true,
            hasTURN: false,
            latency: 0,
            timedOut: true,
            turnResults: []
          });
        }
      });

      // Race between network detection and timeout
      const [connectivity, turnResults] = await Promise.race([
        Promise.all([networkDetectionPromise, stunTurnProbePromise]),
        timeoutPromise.then(result => [result, result.turnResults])
      ]);

      console.log('🔍 BACKGROUND: Network optimization results:', connectivity);
      console.log('🔍 BACKGROUND: TURN probe results:', turnResults?.length || 0, 'servers tested');

      // Apply optimizations even if some tests failed (graceful degradation)
      if (connectivity) {
        // Set network type with fallback to 'open' if detection failed
        const detectedNetworkType = connectivity.networkType || 'open';
        setNetworkType(detectedNetworkType);

        // Determine if we should force relay mode based on available results
        const workingTurnServers = Array.isArray(turnResults) ? turnResults.filter(r => r.working).length : 0;
        const shouldForceRelay = detectedNetworkType === 'restrictive' ||
          (connectivity.latency && connectivity.latency > 1000) ||
          (connectivity.hasSTUN === false) ||
          (workingTurnServers === 0 && detectedNetworkType !== 'open');

        setForceRelayMode(shouldForceRelay);

        if (shouldForceRelay) {
          console.log('🔒 BACKGROUND: Forcing relay mode due to network conditions (graceful fallback)');
        }

        // Apply partial optimizations as they become available
        if (peerConnectionRef.current && !isConnectionEstablished) {
          console.log('🔍 BACKGROUND: Applying available network optimizations');
          applyNetworkOptimizationsGracefully(connectivity, turnResults);
        } else if (isConnectionEstablished) {
          console.log('🔍 BACKGROUND: Connection already established, storing optimizations for future use');
          storeOptimizationsForFutureUse(connectivity, turnResults);
        }

        // Log network issues for debugging without showing user errors
        logNetworkIssuesForDebugging(connectivity, turnResults);
      }

      setNetworkOptimized(true);
      console.log('✅ BACKGROUND: Background optimization stream complete (with graceful fallbacks)');

    } catch (error) {
      // Graceful fallback: continue with defaults and log for debugging
      console.warn('🔍 BACKGROUND: Network optimization failed, using defaults (graceful fallback):', error);

      // Set safe defaults
      setNetworkType('open');
      setForceRelayMode(false);
      setNetworkOptimized(true);

      // Log detailed error for debugging without affecting user experience
      console.error('🔍 BACKGROUND DEBUG: Network optimization error details:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        connectionState: connectionState,
        networkOnline: navigator.onLine
      });
    }
  };

  // Helper function to apply network optimizations gracefully (partial application)
  const applyNetworkOptimizationsGracefully = (connectivity: any, turnResults?: any[]) => {
    if (!peerConnectionRef.current) return;

    try {
      // Only apply optimizations if connection is not yet established
      if (peerConnectionRef.current.connectionState === 'connected') {
        console.log('🔍 BACKGROUND: Connection already established, storing optimizations for next time');
        storeOptimizationsForFutureUse(connectivity, turnResults);
        return;
      }

      // Apply available optimizations progressively
      console.log('🔍 BACKGROUND: Applying graceful network optimizations');

      // Update ICE servers if gathering hasn't completed and we have working TURN servers
      if (peerConnectionRef.current.iceGatheringState !== 'complete') {
        const workingTurnServers = Array.isArray(turnResults) ? turnResults.filter(r => r.working) : [];

        if (workingTurnServers.length > 0) {
          // Store enhanced configuration for potential ICE restart
          const enhancedConfig = buildOptimizedConfiguration(connectivity, turnResults);
          if (enhancedConfig) {
            try {
              sessionStorage.setItem('webrtc_enhanced_config', JSON.stringify(enhancedConfig));
              console.log('🔍 BACKGROUND: Enhanced configuration stored for ICE restart (graceful)');
            } catch (storageError) {
              console.warn('🔍 BACKGROUND: Failed to store enhanced configuration (non-critical):', storageError);
            }
          }
        } else {
          console.log('🔍 BACKGROUND: No working TURN servers found, using STUN-only configuration');
        }
      }

      console.log('✅ BACKGROUND: Graceful network optimizations applied');
    } catch (error) {
      console.warn('🔍 BACKGROUND: Failed to apply graceful optimizations (non-critical):', error);
      // Continue without optimizations - this is non-critical
    }
  };

  // Helper function to log network issues for debugging without user errors
  const logNetworkIssuesForDebugging = (connectivity: any, turnResults?: any[]) => {
    const workingTurnServers = Array.isArray(turnResults) ? turnResults.filter(r => r.working).length : 0;
    const totalTurnServers = Array.isArray(turnResults) ? turnResults.length : 0;

    // Log network conditions for debugging
    console.log('🔍 BACKGROUND DEBUG: Network analysis complete', {
      networkType: connectivity.networkType,
      hasInternet: connectivity.hasInternet,
      hasSTUN: connectivity.hasSTUN,
      hasTURN: connectivity.hasTURN,
      latency: connectivity.latency,
      workingTurnServers: workingTurnServers,
      totalTurnServers: totalTurnServers,
      fallbackUsed: connectivity.fallbackUsed || connectivity.timedOut,
      timestamp: new Date().toISOString()
    });

    // Log warnings for network issues (debugging only, no user errors)
    if (!connectivity.hasInternet) {
      console.warn('🔍 BACKGROUND DEBUG: Network connectivity issues detected');
    }

    if (!connectivity.hasTURN && connectivity.networkType === 'restrictive') {
      console.warn('🔍 BACKGROUND DEBUG: TURN connectivity not available in restrictive network');
    }

    if (!connectivity.hasSTUN) {
      console.warn('🔍 BACKGROUND DEBUG: STUN connectivity failed - NAT traversal may not work properly');
    }

    if (connectivity.latency && connectivity.latency > 1000) {
      console.warn(`🔍 BACKGROUND DEBUG: High network latency detected: ${connectivity.latency}ms`);
    }

    if (totalTurnServers > 0 && workingTurnServers === 0) {
      console.warn('🔍 BACKGROUND DEBUG: No working TURN servers found - may fail in restrictive networks');
    } else if (totalTurnServers > 0) {
      console.log(`🔍 BACKGROUND DEBUG: ${workingTurnServers}/${totalTurnServers} TURN servers working`);
    }

    if (connectivity.fallbackUsed || connectivity.timedOut) {
      console.warn('🔍 BACKGROUND DEBUG: Network detection used fallback values due to timeout or failure');
    }
  };

  // Helper function to apply network optimizations
  const applyNetworkOptimizations = (connectivity: any, turnResults?: any[]) => {
    if (!peerConnectionRef.current) return;

    // Only apply optimizations if connection is not yet established
    if (peerConnectionRef.current.connectionState === 'connected') {
      console.log('🔍 BACKGROUND: Connection already established, storing optimizations for next time');
      storeOptimizationsForFutureUse(connectivity, turnResults);
      return;
    }

    // Apply optimizations to current connection
    console.log('🔍 BACKGROUND: Applying network optimizations to peer connection');

    // Update ICE servers if gathering hasn't completed
    if (peerConnectionRef.current.iceGatheringState !== 'complete') {
      // Note: ICE server updates would require peer connection recreation
      // For now, we'll store the optimizations for the next connection attempt
      console.log('🔍 BACKGROUND: ICE gathering in progress, optimizations will apply to next connection');

      // Store enhanced configuration for potential ICE restart
      const enhancedConfig = buildOptimizedConfiguration(connectivity, turnResults);
      if (enhancedConfig) {
        try {
          sessionStorage.setItem('webrtc_enhanced_config', JSON.stringify(enhancedConfig));
          console.log('🔍 BACKGROUND: Enhanced configuration stored for ICE restart');
        } catch (error) {
          console.warn('🔍 BACKGROUND: Failed to store enhanced configuration:', error);
        }
      }
    }

    console.log('✅ BACKGROUND: Network optimizations applied');
  };

  // Helper function to store optimizations for future use
  const storeOptimizationsForFutureUse = (connectivity: any, turnResults?: any[]) => {
    try {
      const workingTurnServers = Array.isArray(turnResults) ? turnResults.filter(r => r.working) : [];

      const optimizations = {
        networkType: connectivity.networkType,
        forceRelayMode: connectivity.networkType === 'restrictive' || connectivity.latency > 1000 || !connectivity.hasSTUN,
        hasWorkingTurn: workingTurnServers.length > 0,
        workingTurnCount: workingTurnServers.length,
        totalTurnTested: Array.isArray(turnResults) ? turnResults.length : 0,
        latency: connectivity.latency,
        hasSTUN: connectivity.hasSTUN,
        hasTURN: connectivity.hasTURN,
        timestamp: Date.now()
      };

      sessionStorage.setItem('webrtc_optimizations', JSON.stringify(optimizations));
      console.log('🔍 BACKGROUND: Network optimizations stored for future use');

      // Also store the enhanced configuration
      const enhancedConfig = buildOptimizedConfiguration(connectivity, turnResults);
      if (enhancedConfig) {
        sessionStorage.setItem('webrtc_enhanced_config', JSON.stringify(enhancedConfig));
        console.log('🔍 BACKGROUND: Enhanced WebRTC configuration stored');
      }
    } catch (error) {
      console.warn('🔍 BACKGROUND: Failed to store optimizations:', error);
    }
  };

  // Helper function to build optimized configuration
  const buildOptimizedConfiguration = (connectivity: any, turnResults?: any[]) => {
    try {
      const workingTurnServers = Array.isArray(turnResults) ? turnResults.filter(r => r.working) : [];

      if (workingTurnServers.length === 0) {
        console.log('🔍 BACKGROUND: No working TURN servers for enhanced configuration');
        return null;
      }

      // Build enhanced ICE server configuration with working TURN servers
      const enhancedIceServers = [
        // Keep STUN servers if they work
        ...(connectivity.hasSTUN ? [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ] : []),

        // Add working TURN servers with priority to fastest ones
        ...workingTurnServers
          .sort((a, b) => a.latency - b.latency) // Sort by latency (fastest first)
          .slice(0, 3) // Limit to top 3 for performance
          .map(turnResult => {
            // Extract server info from the test result
            // This is a simplified approach - in production you'd want more sophisticated parsing
            if (turnResult.server.includes('metered.ca')) {
              return {
                urls: [
                  'turn:a.relay.metered.ca:80',
                  'turn:a.relay.metered.ca:80?transport=tcp',
                  'turn:a.relay.metered.ca:443?transport=tcp'
                ],
                username: process.env.NEXT_PUBLIC_METERED_TURN_USERNAME || 'openrelayproject',
                credential: process.env.NEXT_PUBLIC_METERED_TURN_CREDENTIAL || 'openrelayproject'
              };
            } else if (turnResult.server.includes('twilio.com')) {
              return {
                urls: [
                  'turn:global.turn.twilio.com:3478?transport=udp',
                  'turn:global.turn.twilio.com:443?transport=tcp'
                ],
                username: process.env.NEXT_PUBLIC_TWILIO_TURN_USERNAME || '',
                credential: process.env.NEXT_PUBLIC_TWILIO_TURN_CREDENTIAL || ''
              };
            } else {
              // Generic TURN server configuration
              return {
                urls: turnResult.server,
                username: 'openrelayproject',
                credential: 'openrelayproject'
              };
            }
          })
      ];

      const enhancedConfig = {
        iceServers: enhancedIceServers,
        iceTransportPolicy: connectivity.networkType === 'restrictive' ? 'relay' : 'all',
        iceCandidatePoolSize: connectivity.networkType === 'restrictive' ? 15 : 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      };

      console.log(`🔍 BACKGROUND: Built enhanced configuration with ${enhancedIceServers.length} ICE servers`);
      return enhancedConfig;
    } catch (error) {
      console.warn('🔍 BACKGROUND: Failed to build optimized configuration:', error);
      return null;
    }
  };

  // Helper function to load stored optimizations for progressive enhancement
  const loadStoredOptimizations = () => {
    try {
      const storedOptimizations = sessionStorage.getItem('webrtc_optimizations');
      const storedConfig = sessionStorage.getItem('webrtc_enhanced_config');

      if (storedOptimizations) {
        const optimizations = JSON.parse(storedOptimizations);

        // Check if optimizations are recent (within last 10 minutes)
        const age = Date.now() - (optimizations.timestamp || 0);
        if (age < 10 * 60 * 1000) { // 10 minutes
          console.log('🔍 PROGRESSIVE: Found recent network optimizations');

          // Apply stored network type and relay mode settings
          if (optimizations.networkType) {
            setNetworkType(optimizations.networkType);
          }
          if (optimizations.forceRelayMode !== undefined) {
            setForceRelayMode(optimizations.forceRelayMode);
          }

          // Return enhanced configuration if available
          if (storedConfig) {
            const enhancedConfig = JSON.parse(storedConfig);
            console.log('🔍 PROGRESSIVE: Using enhanced WebRTC configuration from storage');
            return enhancedConfig;
          }

          return optimizations;
        } else {
          console.log('🔍 PROGRESSIVE: Stored optimizations are too old, clearing');
          sessionStorage.removeItem('webrtc_optimizations');
          sessionStorage.removeItem('webrtc_enhanced_config');
        }
      }

      return null;
    } catch (error) {
      console.warn('🔍 PROGRESSIVE: Failed to load stored optimizations:', error);
      return null;
    }
  };

  // Helper function to apply progressive configuration enhancement
  const applyProgressiveEnhancement = async (peerConnection: RTCPeerConnection) => {
    // Check if we have stored optimizations to apply
    const storedOptimizations = loadStoredOptimizations();

    if (!storedOptimizations) {
      console.log('🔍 PROGRESSIVE: No stored optimizations available');
      return;
    }

    // Apply optimizations without affecting UI or active connections
    if (peerConnection.connectionState === 'connected') {
      console.log('🔍 PROGRESSIVE: Connection already established, optimizations stored for future use');
      return;
    }

    // If we have enhanced configuration and ICE gathering hasn't completed, 
    // we could potentially restart ICE with better configuration
    if (peerConnection.iceGatheringState !== 'complete' &&
      storedOptimizations.iceServers &&
      storedOptimizations.hasWorkingTurn) {

      console.log('🔍 PROGRESSIVE: Enhanced configuration available but ICE gathering in progress');
      console.log(`🔍 PROGRESSIVE: ${storedOptimizations.workingTurnCount}/${storedOptimizations.totalTurnTested} TURN servers working`);

      // Store for potential ICE restart if current connection fails
      console.log('🔍 PROGRESSIVE: Enhanced configuration ready for ICE restart if needed');
    }

    console.log('✅ PROGRESSIVE: Progressive enhancement applied');
  };

  // Execution order enforcement utilities
  const [executionOrder, setExecutionOrder] = useState<{
    mediaAccessStarted: boolean;
    mediaAccessCompleted: boolean;
    uiSetupStarted: boolean;
    uiSetupCompleted: boolean;
    peerConnectionStarted: boolean;
    peerConnectionCompleted: boolean;
    networkDetectionStarted: boolean;
    networkDetectionCompleted: boolean;
  }>({
    mediaAccessStarted: false,
    mediaAccessCompleted: false,
    uiSetupStarted: false,
    uiSetupCompleted: false,
    peerConnectionStarted: false,
    peerConnectionCompleted: false,
    networkDetectionStarted: false,
    networkDetectionCompleted: false,
  });

  // Helper function to validate execution order
  const validateExecutionOrder = (step: string, dependencies: string[] = []): boolean => {
    const violations: string[] = [];

    switch (step) {
      case 'mediaAccess':
        // Media access should always be first - no dependencies
        break;

      case 'uiSetup':
        if (!executionOrder.mediaAccessCompleted) {
          violations.push('UI setup started before media access completed');
        }
        break;

      case 'peerConnection':
        if (!executionOrder.mediaAccessCompleted) {
          violations.push('Peer connection started before media access completed');
        }
        if (!executionOrder.uiSetupCompleted) {
          violations.push('Peer connection started before UI setup completed');
        }
        break;

      case 'networkDetection':
        // Network detection can run in parallel - no strict dependencies
        break;
    }

    if (violations.length > 0) {
      console.error(`⚠️ EXECUTION ORDER VIOLATION in ${step}:`, violations);
      violations.forEach(violation => console.error(`   - ${violation}`));

      // Enhanced development-mode performance alerts
      logExecutionOrderViolationAlert(step, violations);

      return false;
    }

    return true;
  };

  // Helper function to update execution order state
  const updateExecutionOrder = (step: string, phase: 'started' | 'completed') => {
    setExecutionOrder(prev => ({
      ...prev,
      [`${step}${phase === 'started' ? 'Started' : 'Completed'}`]: true
    }));

    console.log(`📋 EXECUTION ORDER: ${step} ${phase}`);
  };

  // Coordinated stream functions with abort signal support and execution order enforcement

  // Immediate UI Stream with coordination support and execution order enforcement
  const initializeImmediateUIStream = async (abortSignal: AbortSignal): Promise<MediaStream | null> => {
    try {
      console.log('🎥 IMMEDIATE: Starting coordinated immediate UI stream with execution order enforcement');

      if (abortSignal.aborted) {
        console.log('🎥 IMMEDIATE: Stream aborted before start');
        return null;
      }

      // Step 1: Media Access (must be first)
      updateExecutionOrder('mediaAccess', 'started');
      validateExecutionOrder('mediaAccess');

      setMediaError(null);

      // Start media access immediately - no waiting
      console.log('🎥 IMMEDIATE: Requesting camera access (Step 1: Media Access)');
      const mediaAccessStartTime = performance.now();
      const stream = await getMediaStreamWithFallback();

      // Detect blocking operations during media access
      detectBlockingOperations('Media Access', mediaAccessStartTime, 2000); // 2s threshold for media access

      if (abortSignal.aborted) {
        console.log('🎥 IMMEDIATE: Stream aborted after media access');
        // Stop tracks if we got them but were aborted
        stream?.getTracks().forEach(track => track.stop());
        return null;
      }

      updateExecutionOrder('mediaAccess', 'completed');
      console.log('✅ IMMEDIATE: Media access completed successfully');

      // Step 2: UI Setup (depends on media access completion)
      updateExecutionOrder('uiSetup', 'started');
      if (!validateExecutionOrder('uiSetup')) {
        console.error('❌ IMMEDIATE: UI setup execution order violation detected');
      }

      console.log('🎥 IMMEDIATE: Setting up UI (Step 2: UI Setup)');

      // Attach to video element immediately
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log('✅ IMMEDIATE: Local preview displayed');

        // Record time-to-first-frame when local preview is displayed (Requirements: 1.2)
        recordTimeToFirstFrame();
      }

      // Store stream reference
      localStreamRef.current = stream;

      // Enable UI controls immediately
      setUIReady(true);
      setMediaReady(true);

      // Record time-to-UI-ready when UI controls are enabled (Requirements: 1.2)
      recordTimeToUIReady();

      updateExecutionOrder('uiSetup', 'completed');
      console.log('✅ IMMEDIATE: UI setup completed successfully');

      console.log('✅ IMMEDIATE: Coordinated UI stream complete with proper execution order - videoTracks=' + stream.getVideoTracks().length + ', audioTracks=' + stream.getAudioTracks().length);
      return stream;
    } catch (error) {
      if (abortSignal.aborted) {
        console.log('🎥 IMMEDIATE: Stream aborted during error handling');
        return null;
      }

      // Show error immediately, don't wait for network detection
      const errorMessage = getMediaAccessErrorMessage(error);
      console.error('❌ IMMEDIATE: Coordinated media access failed:', errorMessage);
      setMediaError(errorMessage);

      // Update execution order to reflect failure
      if (!executionOrder.mediaAccessCompleted) {
        console.error('❌ IMMEDIATE: Media access failed - execution order incomplete');
      }

      throw error;
    }
  };

  // Connection Stream with coordination support and execution order enforcement
  const initializeConnectionStreamCoordinated = async (localStream: MediaStream, abortSignal: AbortSignal): Promise<void> => {
    try {
      console.log('🔗 CONNECTION: Starting coordinated connection stream with execution order enforcement');

      if (abortSignal.aborted) {
        console.log('🔗 CONNECTION: Stream aborted before start');
        return;
      }

      // Step 3: Peer Connection Creation (depends on media access and UI setup completion)
      updateExecutionOrder('peerConnection', 'started');
      if (!validateExecutionOrder('peerConnection')) {
        console.error('❌ CONNECTION: Peer connection execution order violation detected');
      }

      console.log('🔗 CONNECTION: Creating peer connection (Step 3: Peer Connection Creation)');

      // Use default WebRTC config immediately - don't wait for network detection
      console.log('🔗 CONNECTION: Creating peer connection with default config');
      const peerConnectionStartTime = performance.now();
      const peerConnection = await createPeerConnection(false); // Use default config, not forced relay

      // Detect blocking operations during peer connection creation
      detectBlockingOperations('Peer Connection Creation', peerConnectionStartTime, 1000); // 1s threshold

      if (abortSignal.aborted) {
        console.log('🔗 CONNECTION: Stream aborted after peer connection creation');
        peerConnection?.close();
        return;
      }

      if (!peerConnection) {
        console.error('❌ CONNECTION: Failed to create peer connection');
        throw new Error('Failed to create peer connection');
      }

      peerConnectionRef.current = peerConnection;
      console.log('🔗 CONNECTION: PeerConnection created successfully');

      // Add tracks immediately (part of peer connection setup)
      console.log('🔗 CONNECTION: Adding local tracks to PeerConnection');
      localStream.getTracks().forEach((track, index) => {
        if (abortSignal.aborted) {
          console.log('🔗 CONNECTION: Stream aborted during track addition');
          return;
        }

        console.log('🔗 CONNECTION: Adding track ' + (index + 1) + ' - ' + track.kind + ' (' + track.label + ')');

        const sender = protectedAddTrack(peerConnection, track, localStream);

        if (!sender) {
          console.error('❌ CONNECTION: addTrack() blocked - connection is already established');
        }
      });

      if (abortSignal.aborted) {
        console.log('🔗 CONNECTION: Stream aborted after adding tracks');
        return;
      }

      // Setup event handlers (part of peer connection setup)
      setupPeerConnectionEventHandlers(peerConnection);

      // Determine initiator and begin signaling immediately if ready
      const token = localStorage.getItem('authToken');
      let currentUserId = '';

      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          currentUserId = payload.userId || '';
        } catch (error) {
          console.error('Failed to decode token:', error);
          currentUserId = socket.id || `fallback_${Date.now()}`;
        }
      } else {
        currentUserId = socket.id || `fallback_${Date.now()}`;
      }

      const shouldInitiate = currentUserId.localeCompare(partnerId) < 0;
      setIsInitiator(shouldInitiate);

      console.log('🔗 CONNECTION: Initiation logic:', {
        currentUserId,
        partnerId,
        shouldInitiate
      });

      if (abortSignal.aborted) {
        console.log('🔗 CONNECTION: Stream aborted before signaling');
        return;
      }

      // Begin signaling immediately when both peers are ready - no artificial delays
      if (shouldInitiate) {
        console.log('🚀 CONNECTION: This client will initiate - creating offer immediately');
        // No artificial 3-second delay
        if (peerConnection.signalingState === 'stable') {
          createOffer();
        } else {
          // Wait briefly for stable state, then create offer
          const stableStateCheck = registerTimeout(() => {
            if (peerConnectionRef.current && peerConnectionRef.current.signalingState === 'stable' && !abortSignal.aborted) {
              createOffer();
            }
          }, 100, 'Coordinated stable state check for offer creation');

          if (!stableStateCheck) {
            console.log('⏭️ Coordinated stable state check timeout blocked - connection established');
          }
        }
      } else {
        console.log('⏳ CONNECTION: This client will wait for offer from partner');
        // No artificial 15-second fallback timeout during normal operation
      }

      updateExecutionOrder('peerConnection', 'completed');
      setConnectionReady(true);

      // Record time-to-connection-ready when connection is ready (Requirements: 1.2)
      recordTimeToConnectionReady();

      console.log('✅ CONNECTION: Coordinated connection stream complete with proper execution order');

    } catch (error) {
      if (abortSignal.aborted) {
        console.log('🔗 CONNECTION: Stream aborted during error handling');
        return;
      }

      console.error('❌ CONNECTION: Coordinated connection stream failed:', error);

      // Update execution order to reflect failure
      if (!executionOrder.peerConnectionCompleted) {
        console.error('❌ CONNECTION: Peer connection creation failed - execution order incomplete');
      }

      throw error;
    }
  };

  // Background Optimization Stream with coordination support and execution order enforcement
  const initializeBackgroundOptimizationStream = async (abortSignal: AbortSignal): Promise<void> => {
    // Start network detection without blocking UI or connection
    console.log('🔍 BACKGROUND: Starting coordinated background optimization stream with execution order enforcement');

    if (abortSignal.aborted) {
      console.log('🔍 BACKGROUND: Stream aborted before start');
      setNetworkOptimized(true);
      return;
    }

    // Step 4: Network Detection (runs in parallel - no strict dependencies)
    updateExecutionOrder('networkDetection', 'started');
    validateExecutionOrder('networkDetection'); // Should always pass since no dependencies

    console.log('🔍 BACKGROUND: Starting network detection (Step 4: Network Detection - Parallel)');

    // Only run during pre-connection phase
    if (!shouldRunPreConnectionLogic() || WebRTCManager.getCallIsConnected()) {
      console.log('⏭️ BACKGROUND: Skipping network detection - connection established or blocked');
      updateExecutionOrder('networkDetection', 'completed');
      setNetworkOptimized(true);
      return;
    }

    try {
      // Start network detection and STUN/TURN probing without blocking
      // Use Promise-based approach instead of blocking await operations
      console.log('🔍 BACKGROUND: Starting parallel network detection and STUN/TURN probing');

      const networkDetectionPromise = testWebRTCConnectivity().catch(error => {
        console.warn('🔍 BACKGROUND: Network connectivity test failed (non-critical):', error);
        // Return default connectivity result on failure
        return {
          networkType: 'open',
          hasInternet: true,
          hasSTUN: true,
          hasTURN: false,
          latency: 0,
          fallbackUsed: true
        };
      });

      const stunTurnProbePromise = import('../lib/turn-test').then(({ testAllTURNServers }) =>
        testAllTURNServers().catch(error => {
          console.warn('🔍 BACKGROUND: STUN/TURN probing failed (non-critical):', error);
          return [];
        })
      );

      // Don't await - let these run in background with 2-second timeout fallback
      const timeoutPromise = new Promise<any>((resolve) => {
        const timeoutHandle = registerTimeout(() => {
          if (!abortSignal.aborted) {
            console.log('🔍 BACKGROUND: Network detection timeout - using defaults');
            resolve({
              networkType: 'open',
              hasInternet: true,
              hasSTUN: true,
              hasTURN: false,
              latency: 0,
              timedOut: true,
              turnResults: []
            });
          }
        }, 2000, 'Coordinated background optimization timeout'); // 2-second timeout fallback to default configuration

        if (!timeoutHandle) {
          console.log('⏭️ BACKGROUND: Coordinated network detection timeout blocked - connection established');
          resolve({
            networkType: 'open',
            hasInternet: true,
            hasSTUN: true,
            hasTURN: false,
            latency: 0,
            timedOut: true,
            turnResults: []
          });
        }
      });

      // Race between network detection and timeout
      const [connectivity, turnResults] = await Promise.race([
        Promise.all([networkDetectionPromise, stunTurnProbePromise]),
        timeoutPromise.then(result => [result, result.turnResults])
      ]);

      if (abortSignal.aborted) {
        console.log('🔍 BACKGROUND: Stream aborted after network detection');
        return;
      }

      console.log('🔍 BACKGROUND: Coordinated network optimization results:', connectivity);
      console.log('🔍 BACKGROUND: TURN probe results:', turnResults?.length || 0, 'servers tested');

      if (connectivity) {
        // Apply network optimizations with graceful fallbacks
        const detectedNetworkType = connectivity.networkType || 'open';
        setNetworkType(detectedNetworkType);

        // Determine if we should force relay mode based on available results
        const workingTurnServers = Array.isArray(turnResults) ? turnResults.filter(r => r.working).length : 0;
        const shouldForceRelay = detectedNetworkType === 'restrictive' ||
          (connectivity.latency && connectivity.latency > 1000) ||
          (connectivity.hasSTUN === false) ||
          (workingTurnServers === 0 && detectedNetworkType !== 'open');

        setForceRelayMode(shouldForceRelay);

        if (shouldForceRelay) {
          console.log('🔒 BACKGROUND: Forcing relay mode due to network conditions (graceful fallback)');
        }

        // Apply optimizations asynchronously when results are available
        // Verify UI setup proceeds regardless of network detection status (Requirement 5.3, 7.1, 7.2)
        if (peerConnectionRef.current && !isConnectionEstablished && !abortSignal.aborted) {
          console.log('🔍 BACKGROUND: Applying graceful network optimizations to existing connection');
          console.log('🔍 BACKGROUND: UI setup status - Media Ready:', mediaReady, 'UI Ready:', uiReady);
          // Apply optimizations without affecting UI or active connections
          applyNetworkOptimizationsGracefully(connectivity, turnResults);
        } else if (isConnectionEstablished) {
          console.log('🔍 BACKGROUND: Connection already established, storing optimizations for future use');
          // Store optimizations for future connections
          storeOptimizationsForFutureUse(connectivity, turnResults);
        }

        // Log network issues for debugging without showing user errors (only if not aborted)
        if (!abortSignal.aborted) {
          logNetworkIssuesForDebugging(connectivity, turnResults);
        }
      }

      if (!abortSignal.aborted) {
        updateExecutionOrder('networkDetection', 'completed');
        setNetworkOptimized(true);

        // Record time-to-fully-optimized when background optimization completes (Requirements: 1.2)
        recordTimeToFullyOptimized();

        console.log('✅ BACKGROUND: Coordinated background optimization stream complete with proper execution order');

        // Verify that UI setup proceeded regardless of network detection status
        if (mediaReady && uiReady) {
          console.log('✅ BACKGROUND: Confirmed UI setup completed independently of network detection');
        } else {
          console.warn('⚠️ BACKGROUND: UI setup may have been blocked by network detection - execution order violation');
        }
      }

    } catch (error) {
      if (abortSignal.aborted) {
        console.log('🔍 BACKGROUND: Stream aborted during error handling');
        return;
      }

      // Graceful fallback: continue with defaults and log for debugging
      console.warn('🔍 BACKGROUND: Coordinated network optimization failed, using defaults (graceful fallback):', error);

      // Set safe defaults
      setNetworkType('open');
      setForceRelayMode(false);

      // Update execution order to reflect completion even on failure (non-critical)
      updateExecutionOrder('networkDetection', 'completed');
      setNetworkOptimized(true);

      // Record time-to-fully-optimized even on failure (Requirements: 1.2)
      recordTimeToFullyOptimized();

      // Log detailed error for debugging without affecting user experience
      console.error('🔍 BACKGROUND DEBUG: Coordinated network optimization error details:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        connectionState: connectionState,
        networkOnline: navigator.onLine,
        aborted: abortSignal.aborted
      });

      // Ensure UI independence from network detection failures (Requirement 7.3)
      if (!mediaReady || !uiReady) {
        console.error('❌ BACKGROUND: Network detection failure affected UI setup - this violates execution order requirements');
      }
    }
  };

  const initializeVideoChat = async () => {
    try {
      console.log('🚀 INITIALIZATION: Starting parallel stream execution');
      // Keep 'matched' state initially to show "Setting up camera and microphone..."
      // Will change to 'connecting' after media is ready
      setConnectionPhase('pre-connection');
      setNetworkDetectionFrozen(false);
      setMediaError(null);

      // Reset parallel execution state
      setMediaReady(false);
      setUIReady(false);
      setConnectionReady(false);
      setNetworkOptimized(false);

      // Start all three streams concurrently - no blocking operations
      console.log('🚀 INITIALIZATION: Launching parallel streams');

      // Stream 1: Immediate UI Stream (target: <500ms)
      const immediateUIPromise = initializeImmediateUI();

      // Stream 3: Background Optimization Stream (non-blocking)
      const backgroundOptimizationPromise = initializeBackgroundOptimization();

      // Wait for media access to complete before starting connection stream
      let localStream: MediaStream | null;
      try {
        localStream = await immediateUIPromise;
        if (!localStream) {
          throw new Error('Failed to get media stream');
        }
        console.log('✅ INITIALIZATION: Immediate UI stream completed');

        // Now that media is ready, change to connecting state
        setConnectionState('connecting');
      } catch (error) {
        console.error('❌ INITIALIZATION: Immediate UI stream failed:', error);
        return; // Don't proceed without media
      }

      // Stream 2: Connection Stream (starts after media is ready)
      const connectionStreamPromise = initializeConnectionStream(localStream);

      // Handle connection stream completion
      try {
        await connectionStreamPromise;
        console.log('✅ INITIALIZATION: Connection stream completed');
      } catch (error) {
        console.error('❌ INITIALIZATION: Connection stream failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to initialize connection';
        setMediaError(errorMessage);
        onError(errorMessage);
        return;
      }

      // Set initial connection timeout ONLY during pre-connection phase
      // CRITICAL FIX: Only trigger timeout if ICE connection actually fails, not based on time elapsed
      if (shouldRunPreConnectionLogic() && !WebRTCManager.getCallIsConnected()) {
        const timeout = registerTimeout(() => {
          if (!isConnectionEstablished && connectionState !== 'connected') {
            // CRITICAL: Check ICE state before triggering timeout - only fail if ICE is actually failed
            const iceState = peerConnectionRef.current?.iceConnectionState;
            if (iceState === 'failed') {
              console.log('Initial connection timeout reached with ICE failure - triggering reconnection');
              handleInitialConnectionTimeout();
            } else {
              console.log(`Initial connection timeout reached but ICE state is "${iceState}" - extending timeout to allow ICE completion`);
              // Extend timeout to allow ICE negotiation to complete naturally
              const extendedTimeout = registerTimeout(() => {
                const currentIceState = peerConnectionRef.current?.iceConnectionState;
                if (currentIceState === 'failed') {
                  console.log('Extended timeout reached with ICE failure - triggering reconnection');
                  handleInitialConnectionTimeout();
                } else {
                  console.log(`Extended timeout reached but ICE state is "${currentIceState}" - allowing connection to continue`);
                }
              }, 30000, 'Extended ICE completion timeout'); // 30s extension for ICE completion

              if (extendedTimeout) {
                setInitialConnectionTimeout(extendedTimeout);
              }
            }
          }
        }, INITIAL_CONNECTION_TIMEOUT_CONST, 'Initial connection timeout');

        if (timeout) {
          setInitialConnectionTimeout(timeout);
        } else {
          console.log('⏭️ Initial connection timeout blocked - connection already established');
        }
      } else {
        console.log('⏭️ Skipping initial connection timeout - connection established or pre-connection logic blocked');
      }

      // Background optimization continues independently
      backgroundOptimizationPromise.catch(error => {
        console.warn('🔍 BACKGROUND: Background optimization failed (non-critical):', error);
      });

      console.log('🎉 INITIALIZATION: Parallel stream coordination complete');
      console.log('📊 INITIALIZATION: Stream status - UI Ready:', isUserInterfaceReady(), 'Connection Ready:', isConnectionReady());

    } catch (error) {
      console.error('❌ INITIALIZATION: Failed to initialize video chat:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize video chat';
      setMediaError(errorMessage);
      onError(errorMessage);
    }
  };

  const createPeerConnection = async (forceRelay: boolean = false): Promise<RTCPeerConnection | null> => {
    // Check if peer connection recreation should be blocked
    // Requirements: 3.3 - Prevent RTCPeerConnection recreation when connected
    if (isPeerConnectionRecreationBlocked()) {
      console.error('❌ Cannot create peer connection: Connection is already established');
      return null;
    }

    // Check for stored optimizations and use enhanced configuration if available
    const storedOptimizations = loadStoredOptimizations();
    let config;

    if (storedOptimizations && storedOptimizations.iceServers) {
      console.log('🔍 PROGRESSIVE: Using enhanced configuration from stored optimizations');
      config = storedOptimizations;

      // Override forceRelay if stored optimizations suggest it
      if (storedOptimizations.iceTransportPolicy === 'relay') {
        forceRelay = true;
        console.log('🔒 PROGRESSIVE: Forcing relay mode based on stored optimizations');
      }
    } else {
      // Get enhanced WebRTC configuration with network traversal support
      config = await getWebRTCConfiguration(forceRelay);
    }

    console.log(`🔧 Creating peer connection with ${config.iceServers.length} ICE servers`);
    console.log(`🔧 ICE transport policy: ${config.iceTransportPolicy || 'all'}`);

    // Log TURN servers for debugging
    const turnServers = config.iceServers.filter((server: any) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url: string) => url.startsWith('turn'));
    });

    console.log(`🔧 TURN servers configured: ${turnServers.length}`);
    turnServers.forEach((server: any, index: number) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      console.log(`   TURN ${index + 1}: ${urls[0]} (${server.username ? 'with credentials' : 'no credentials'})`);
    });

    if (forceRelay) {
      console.log('🔒 FORCED RELAY MODE: Only TURN servers will be used');
    }

    // Use protected peer connection creation
    // Requirements: 3.3 - Prevent RTCPeerConnection recreation when connected
    const peerConnection = createProtectedPeerConnection(config);

    if (!peerConnection) {
      console.error('❌ Failed to create protected peer connection');
      return null;
    }

    // Setup connection state monitoring with global authority flag
    WebRTCManager.monitorConnectionState(peerConnection);

    // Setup all event handlers
    setupPeerConnectionEventHandlers(peerConnection);

    // Apply progressive configuration enhancement
    await applyProgressiveEnhancement(peerConnection);

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
      console.log('📨 SIGNALING: Creating WebRTC offer');

      // Use protected createOffer method
      // Requirements: 3.4 - Block connection modification methods except getStats()
      const offerPromise = protectedCreateOffer(peerConnectionRef.current, {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: false // Don't restart ICE unless necessary
      });

      if (!offerPromise) {
        console.error('❌ createOffer() blocked - connection is already established');
        return;
      }

      const offer = await offerPromise;
      console.log('📨 SIGNALING: Offer created successfully');

      console.log('📨 SIGNALING: Setting local description');

      // Use protected setLocalDescription method
      // Requirements: 3.4 - Block connection modification methods except getStats()
      const setLocalPromise = protectedSetLocalDescription(peerConnectionRef.current, offer);

      if (!setLocalPromise) {
        console.error('❌ setLocalDescription() blocked - connection is already established');
        return;
      }

      await setLocalPromise;
      console.log('📨 SIGNALING: Local description set');

      // Wait a moment for ICE gathering to start
      await new Promise(resolve => {
        const iceGatheringDelay = registerTimeout(() => resolve(undefined), 500, 'ICE gathering start delay');
        if (!iceGatheringDelay) {
          // If timeout is blocked, resolve immediately
          resolve(undefined);
        }
      });

      console.log('📤 SIGNALING: Sending offer to partner');
      socket.emit('offer', offer);

      console.log('✅ SIGNALING: Offer sent successfully');

      // Set a timeout for receiving an answer
      const answerTimeout = registerTimeout(() => {
        if (peerConnectionRef.current &&
          peerConnectionRef.current.signalingState === 'have-local-offer' &&
          connectionState !== 'connected') {
          console.log('⏰ No answer received within 10s, may need to retry');
          // Don't automatically retry here, let the connection timeout handle it
        }
      }, 10000, 'Answer reception timeout');

      if (!answerTimeout) {
        console.log('⏭️ Answer timeout blocked - connection already established');
      }

    } catch (error) {
      console.error('❌ Error creating offer:', error);
      onError('Failed to create connection offer. Retrying...');

      // Retry after exponential backoff delay (Requirements 4.2)
      const retryDelay = calculateExponentialBackoffDelay(1, 2000, 8000); // Start with 2s, max 8s for offer retries
      const retryTimeout = registerTimeout(() => {
        if (peerConnectionRef.current && peerConnectionRef.current.signalingState === 'stable') {
          console.log('🔄 Retrying offer creation...');
          createOffer();
        }
      }, retryDelay, 'Offer creation retry timeout');

      if (!retryTimeout) {
        console.log('⏭️ Offer retry timeout blocked - connection already established');
      }
    }
  };

  const handleReceiveOffer = useCallback(async (offer: RTCSessionDescriptionInit) => {
    if (!peerConnectionRef.current) {
      console.log('❌ Cannot handle offer: peer connection not available');
      return;
    }

    try {
      console.log('📩 SIGNALING: Received offer from partner');

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
            // Use protected setLocalDescription method for rollback
            // Requirements: 3.4 - Block connection modification methods except getStats()
            const rollbackPromise = protectedSetLocalDescription(peerConnectionRef.current, { type: 'rollback' });

            if (rollbackPromise) {
              await rollbackPromise;
            } else {
              console.warn('⚠️ Rollback blocked - connection is already established');
            }
          } catch (rollbackError) {
            console.warn('Rollback failed, continuing anyway:', rollbackError);
          }
        } else {
          console.log('⏳ Ignoring offer collision - keeping our offer');
          return;
        }
      }

      // Use protected setRemoteDescription method
      // Requirements: 3.4 - Block connection modification methods except getStats()
      const setRemotePromise = protectedSetRemoteDescription(peerConnectionRef.current, offer);

      if (!setRemotePromise) {
        console.error('❌ setRemoteDescription() blocked - connection is already established');
        return;
      }

      await setRemotePromise;
      console.log('📩 SIGNALING: Remote description set');

      console.log('📨 SIGNALING: Creating answer');

      // Use protected createAnswer method
      // Requirements: 3.4 - Block connection modification methods except getStats()
      const answerPromise = protectedCreateAnswer(peerConnectionRef.current, {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      if (!answerPromise) {
        console.error('❌ createAnswer() blocked - connection is already established');
        return;
      }

      const answer = await answerPromise;
      console.log('📨 SIGNALING: Answer created');

      console.log('📨 SIGNALING: Setting local description with answer');

      // Use protected setLocalDescription method
      // Requirements: 3.4 - Block connection modification methods except getStats()
      const setLocalAnswerPromise = protectedSetLocalDescription(peerConnectionRef.current, answer);

      if (!setLocalAnswerPromise) {
        console.error('❌ setLocalDescription() blocked - connection is already established');
        return;
      }

      await setLocalAnswerPromise;
      console.log('📨 SIGNALING: Local description set with answer');

      console.log('📤 SIGNALING: Sending answer to partner');
      socket.emit('answer', answer);
      console.log('✅ SIGNALING: Answer sent successfully');
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
      const retryTimeout = registerTimeout(() => {
        if (peerConnectionRef.current && offer && !peerConnectionRef.current.remoteDescription) {
          console.log('🔄 Retrying offer handling...');
          handleReceiveOffer(offer);
        }
      }, retryDelay, 'Offer handling retry timeout');

      if (!retryTimeout) {
        console.log('⏭️ Offer handling retry timeout blocked - connection already established');
      }
    }
  }, [socket, onError, partnerId]);

  const handleReceiveAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (!peerConnectionRef.current) {
      console.log('❌ Cannot handle answer: peer connection not available');
      return;
    }

    try {
      console.log('📩 SIGNALING: Received answer from partner');

      // Check if we already have a remote description
      if (peerConnectionRef.current.remoteDescription) {
        console.log('⚠️ Remote description already set, ignoring duplicate answer');
        return;
      }

      // Ensure we're in the correct signaling state
      if (peerConnectionRef.current.signalingState !== 'have-local-offer') {
        console.log('⚠️ Unexpected signaling state for answer: ' + peerConnectionRef.current.signalingState);
        return;
      }

      // Use protected setRemoteDescription method
      // Requirements: 3.4 - Block connection modification methods except getStats()
      const setRemotePromise = protectedSetRemoteDescription(peerConnectionRef.current, answer);

      if (!setRemotePromise) {
        console.error('❌ setRemoteDescription() blocked - connection is already established');
        return;
      }

      await setRemotePromise;
      console.log('✅ SIGNALING: Answer processed successfully');
    } catch (error) {
      console.error('❌ Error handling answer:', error);
      onError('Failed to handle connection answer. Retrying...');

      // Retry after exponential backoff delay (Requirements 4.2)
      const retryDelay = calculateExponentialBackoffDelay(1, 2000, 8000); // Start with 2s, max 8s for answer handling retries
      const retryTimeout = registerTimeout(() => {
        if (peerConnectionRef.current && answer && !peerConnectionRef.current.remoteDescription) {
          console.log('🔄 Retrying answer handling...');
          handleReceiveAnswer(answer);
        }
      }, retryDelay, 'Answer handling retry timeout');

      if (!retryTimeout) {
        console.log('⏭️ Answer handling retry timeout blocked - connection already established');
      }
    }
  }, [onError]);

  const handleReceiveIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!peerConnectionRef.current) return;

    try {
      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('❄️ ICE: Candidate received and added - ' + candidate.candidate?.split(' ')[7] || 'unknown');
    } catch (error) {
      console.error('❌ ICE: Error adding candidate:', error);
      // ICE candidate errors are usually not critical, so we don't show user error
    }
  }, []);

  const handleCallEnded = useCallback(() => {
    console.log('🛑 CALL END: Call ended by partner');
    cleanup();
    onCallEnd();
  }, [onCallEnd]);

  const handlePartnerDisconnected = useCallback(() => {
    console.log('🛑 CALL END: Partner disconnected');
    cleanup();
    onCallEnd();
  }, [onCallEnd]);

  const handlePartnerTimeout = useCallback(() => {
    console.log('⏰ CALL END: Partner session timed out');
    cleanup();
    onError('Your chat partner\'s session timed out due to inactivity.');
    const endCallTimeout = registerTimeout(() => {
      onCallEnd();
    }, 2000, 'End call timeout after partner timeout');

    if (!endCallTimeout) {
      onCallEnd(); // Call immediately if timeout is blocked
    }
  }, [onCallEnd, onError]);

  const handleSessionTimeout = useCallback(() => {
    console.log('⏰ CALL END: Session timed out due to inactivity');
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
    const clearReconnectMessageTimeout = registerTimeout(() => {
      // Clear the reconnection message after a few seconds
      if (connectionState === 'connected') {
        onError('');
      }
    }, 3000, 'Clear partner reconnected message timeout');

    if (!clearReconnectMessageTimeout) {
      console.log('⏭️ Clear reconnect message timeout blocked - connection already established');
    }
  }, [onError, connectionState]);

  const cleanup = () => {
    console.log('🧹 CLEANUP: Starting cleanup process');

    // Send browser closing event if socket is still connected (Requirements 8.1)
    if (socket && socket.connected) {
      console.log('🧹 CLEANUP: Sending browser closing event to server');
      socket.emit('browser-closing');
    }

    // Reset the global connection authority flag
    console.log('🧹 CLEANUP: Resetting global connection authority flag');
    WebRTCManager.setCallIsConnected(false);

    // Clear session state from storage when explicitly ending call (Requirements 5.5)
    try {
      sessionStorage.removeItem('videoChat_sessionState');
      console.log('🧹 CLEANUP: Session state cleared from storage');
    } catch (error) {
      console.warn('🧹 CLEANUP: Failed to clear session state:', error);
    }

    // Stop quality monitoring
    if (qualityMonitorRef.current) {
      console.log('🧹 CLEANUP: Stopping quality monitoring');
      qualityMonitorRef.current.stop();
      qualityMonitorRef.current = null;
    }

    // Stop network traversal monitoring
    if (networkTraversalMonitorRef.current) {
      console.log('🧹 CLEANUP: Stopping network traversal monitoring');
      networkTraversalMonitorRef.current = null;
    }

    // Clear all timeout timers to prevent memory leaks and conflicts (Requirements 3.5)
    console.log('🧹 CLEANUP: Clearing all timeout timers');
    clearAllTimeoutTimers();
    clearGraceTimers();

    // Clear initial connection timeout
    if (initialConnectionTimeout) {
      console.log('🧹 CLEANUP: Clearing initial connection timeout');
      clearTimeout(initialConnectionTimeout);
      setInitialConnectionTimeout(null);
    }

    // Stop local stream
    if (localStreamRef.current) {
      console.log('🧹 CLEANUP: Stopping local media stream tracks');
      localStreamRef.current.getTracks().forEach((track, index) => {
        console.log('🧹 CLEANUP: Stopping track ' + (index + 1) + ' - ' + track.kind + ' (' + track.label + ')');
        track.stop();
      });
      localStreamRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      console.log('🧹 CLEANUP: Closing peer connection');
      // Use protected close method
      // Requirements: 3.4 - Allow close() for cleanup but log the action
      protectedClose(peerConnectionRef.current);
      peerConnectionRef.current = null;
    }

    // Clear video elements
    if (localVideoRef.current) {
      console.log('🧹 CLEANUP: Clearing local video element');
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      console.log('🧹 CLEANUP: Clearing remote video element');
      remoteVideoRef.current.srcObject = null;
    }

    // Reset all state including frozen detection
    console.log('🧹 CLEANUP: Resetting component state');
    setConnectionState('ended');
    setConnectionPhase('pre-connection');
    setNetworkDetectionFrozen(false);
    setIsConnectionEstablished(false);
    setIsReconnecting(false);
    setReconnectAttempts(0);
    setSessionState({}); // Clear session state
    setNetworkRecoveryInProgress(false);

    // Reset parallel execution state
    setMediaReady(false);
    setUIReady(false);
    setConnectionReady(false);
    setNetworkOptimized(false);

    console.log('✅ CLEANUP: Cleanup process completed');
  };

  const toggleAudio = () => {
    console.log('🎤 USER ACTION: Audio toggle requested - current state: ' + (isAudioMuted ? 'muted' : 'unmuted'));
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
        console.log('🎤 USER ACTION: Audio ' + (audioTrack.enabled ? 'unmuted' : 'muted'));
      }
    }
  };

  const toggleVideo = () => {
    console.log('📹 USER ACTION: Video toggle requested - current state: ' + (isVideoDisabled ? 'disabled' : 'enabled'));
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoDisabled(!videoTrack.enabled);
        console.log('📹 USER ACTION: Video ' + (videoTrack.enabled ? 'enabled' : 'disabled'));
      }
    }
  };

  const endCall = () => {
    console.log('🛑 USER ACTION: End call button clicked');
    socket.emit('end-call');
    cleanup();
    onCallEnd();
  };

  const skipUser = () => {
    console.log('⏭️ USER ACTION: Skip user button clicked');
    socket.emit('skip-user');
    cleanup();
    onCallEnd();
  };

  const reportUser = () => {
    console.log('⚠️ USER ACTION: Report user button clicked');
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
    console.log('Initial connection timeout - checking ICE state before taking action');

    // CRITICAL: Do not run timeout logic if network detection is frozen
    if (networkDetectionFrozen) {
      console.log('⏭️ Ignoring initial connection timeout - network detection frozen (connection established)');
      return;
    }

    // CRITICAL: Block timeout handlers when CALL_IS_CONNECTED = true
    // Requirements: 1.5, 3.5 - Prevent timeout handlers from triggering reconnection
    if (shouldBlockReconnectionOperation('Initial connection timeout handler')) {
      console.log('🚫 Initial connection timeout handler blocked - connection is established');
      return;
    }

    // CRITICAL FIX: Only proceed with reconnection if ICE connection is actually failed
    const iceState = peerConnectionRef.current?.iceConnectionState;
    const connectionState = peerConnectionRef.current?.connectionState;

    if (iceState !== 'failed' && connectionState !== 'failed') {
      console.log(`⏭️ Ignoring timeout - ICE state: "${iceState}", connection state: "${connectionState}" - allowing natural completion`);
      return;
    }

    console.log(`🔴 ICE connection actually failed - ICE state: "${iceState}", connection state: "${connectionState}" - proceeding with reconnection`);

    // Only extend timeout during initial connection setup, not for established connections
    if (!isConnectionEstablished && connectionState === 'connecting' && reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST) {
      console.log('Connection still in progress, extending timeout...');
      // Implement exponential backoff for timeout extensions (Requirements 4.2)
      const extensionTime = calculateExponentialBackoffDelay(reconnectAttempts + 1, CONNECTION_SETUP_EXTENSION_CONST, MAX_RECONNECT_DELAY_CONST);

      console.log(`Extending timeout by ${extensionTime}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS_CONST})`);

      const extendedTimeout = registerTimeout(() => {
        if (!isConnectionEstablished && peerConnectionRef.current) {
          // CRITICAL FIX: Only trigger reconnection if ICE is actually failed
          const currentIceState = peerConnectionRef.current.iceConnectionState;
          const currentConnectionState = peerConnectionRef.current.connectionState;

          if (currentIceState === 'failed' || currentConnectionState === 'failed') {
            console.log(`Extended connection timeout reached with actual failure - ICE: "${currentIceState}", connection: "${currentConnectionState}"`);
            handleInitialConnectionTimeout();
          } else {
            console.log(`Extended timeout reached but connection is still viable - ICE: "${currentIceState}", connection: "${currentConnectionState}" - allowing to continue`);
          }
        }
      }, extensionTime, `Extended connection timeout (attempt ${reconnectAttempts + 1})`);

      if (extendedTimeout) {
        setInitialConnectionTimeout(extendedTimeout);
      } else {
        console.log('⏭️ Extended timeout blocked - connection already established');
      }

      // Increment reconnect attempts for progressive extension
      setReconnectAttempts(prev => prev + 1);
    } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST && shouldRunPreConnectionLogic()) {
      attemptReconnection();
    } else {
      console.log('Max reconnection attempts reached during initial setup, showing error');
      // Improved error handling for maximum retry scenarios (Requirements 4.5)
      const errorMessage = `Connection timeout after ${MAX_RECONNECT_ATTEMPTS_CONST} attempts. This may be due to network issues or firewall restrictions. Please check your internet connection and try again.`;
      onError(errorMessage);
      setConnectionState('failed');

      // Provide recovery options to user
      const recoveryOptionsTimeout = registerTimeout(() => {
        onError(`${errorMessage} You can try refreshing the page or checking your network settings.`);
      }, 3000, 'Recovery options message timeout');

      if (!recoveryOptionsTimeout) {
        console.log('⏭️ Recovery options timeout blocked - connection already established');
      }
    }
  };

  const handleConnectionLoss = () => {
    console.log('Connection lost - checking for reconnection');

    // CRITICAL: Block reconnection attempts when CALL_IS_CONNECTED = true
    // Requirements: 1.5, 3.5 - Prevent reconnection logic after connection
    if (shouldBlockReconnectionOperation('Connection loss handler')) {
      console.log('🚫 Connection loss handler blocked - connection is established');
      return;
    }

    // Clear grace timers since we're now handling the connection loss
    clearGraceTimers();

    if (connectionState === 'connected' && reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST && !isReconnecting) {
      attemptReconnection();
    }
  };

  const handleConnectionFailure = () => {
    console.log('Connection failed - attempting recovery');

    // CRITICAL: Block reconnection attempts when CALL_IS_CONNECTED = true
    // Requirements: 1.5, 3.5 - Prevent reconnection logic after connection
    if (shouldBlockReconnectionOperation('Connection failure handler')) {
      console.log('🚫 Connection failure handler blocked - connection is established');
      return;
    }

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
      const additionalGuidanceTimeout = registerTimeout(() => {
        onError('You can also try connecting from a different network or contact support if issues continue.');
      }, 5000, 'Additional recovery guidance timeout');

      if (!additionalGuidanceTimeout) {
        console.log('⏭️ Additional guidance timeout blocked - connection already established');
      }
    }
  };

  const handleEnhancedICERestart = async () => {
    console.log('🔄 RECONNECTION: Handling enhanced ICE restart for network traversal');

    // CRITICAL: Block ICE restart attempts when CALL_IS_CONNECTED = true
    // Requirements: 3.5 - Prevent ICE restart logic after connection
    if (isICERestartBlocked()) {
      console.log('🚫 RECONNECTION: ICE restart blocked - connection is established');
      return;
    }

    if (!peerConnectionRef.current || isReconnecting) {
      console.log('❌ RECONNECTION: Cannot perform ICE restart - peer connection unavailable or already reconnecting');
      return;
    }

    // Clear grace timers since we're handling the ICE failure
    clearGraceTimers();

    try {
      const currentAttempt = iceRestartAttempts + 1;
      setIceRestartAttempts(currentAttempt);

      console.log(`🔄 RECONNECTION: ICE restart attempt ${currentAttempt}/3`);

      // Check if peer connection is in stable state for ICE restart
      if (peerConnectionRef.current.signalingState !== 'stable') {
        console.log(`⚠️ RECONNECTION: Cannot restart ICE in signaling state: ${peerConnectionRef.current.signalingState}`);

        // Wait for stable state or fall back to full reconnection
        const stableStateTimeout = registerTimeout(() => {
          if (peerConnectionRef.current?.signalingState === 'stable') {
            handleEnhancedICERestart();
          } else {
            console.log('⚠️ RECONNECTION: Signaling state not stable, falling back to full reconnection');
            // Check if reconnection should be blocked
            if (!isReconnectionBlocked()) {
              attemptReconnection();
            } else {
              console.log('🚫 RECONNECTION: Fallback reconnection blocked - connection is established');
            }
          }
        }, 1000, 'ICE restart stable state timeout');

        if (!stableStateTimeout) {
          console.log('⏭️ ICE restart stable state timeout blocked - connection already established');
        }
        return;
      }

      // Force relay mode for ICE restart if we're in a restrictive network
      const shouldForceRelay = networkType === 'restrictive' || currentAttempt > 1;

      if (shouldForceRelay && !forceRelayMode) {
        console.log('🔒 RECONNECTION: Forcing relay mode for ICE restart due to previous failures');
        setForceRelayMode(true);

        // Recreate peer connection with relay-only mode
        const newConfig = await getWebRTCConfiguration(true);

        // Use protected peer connection creation
        // Requirements: 3.3 - Prevent RTCPeerConnection recreation when connected
        const newPeerConnection = createProtectedPeerConnection(newConfig);

        if (!newPeerConnection) {
          console.error('❌ RECONNECTION: Failed to create relay-mode peer connection - connection may already be established');
          return;
        }

        // Copy event handlers and tracks from old connection
        await recreatePeerConnectionWithRelayMode(newPeerConnection);
        return;
      }

      // Perform proper ICE restart using createOffer with iceRestart: true
      console.log('🔄 RECONNECTION: Creating ICE restart offer');

      // Use protected createOffer method for ICE restart
      // Requirements: 3.4 - Block connection modification methods except getStats()
      const offerPromise = protectedCreateOffer(peerConnectionRef.current, {
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      if (!offerPromise) {
        console.error('❌ RECONNECTION: ICE restart createOffer() blocked - connection is already established');
        return;
      }

      const offer = await offerPromise;

      console.log('📝 RECONNECTION: Setting local description for ICE restart');

      // Use protected setLocalDescription method for ICE restart
      // Requirements: 3.4 - Block connection modification methods except getStats()
      const setLocalPromise = protectedSetLocalDescription(peerConnectionRef.current, offer);

      if (!setLocalPromise) {
        console.error('❌ RECONNECTION: ICE restart setLocalDescription() blocked - connection is already established');
        return;
      }

      await setLocalPromise;

      // Send the ICE restart offer
      console.log('📤 RECONNECTION: Sending ICE restart offer');
      socket.emit('offer', offer);

      console.log('✅ RECONNECTION: ICE restart initiated successfully');

      // Set timeout for ICE restart completion
      const iceRestartTimeout = registerTimeout(() => {
        if (peerConnectionRef.current &&
          (peerConnectionRef.current.iceConnectionState === 'failed' ||
            peerConnectionRef.current.iceConnectionState === 'disconnected')) {
          console.log('❌ RECONNECTION: ICE restart timeout - connection still failed');

          if (currentAttempt < 3) {
            handleEnhancedICERestart();
          } else {
            console.log('❌ RECONNECTION: Max ICE restart attempts reached, falling back to full reconnection');
            // Check if reconnection should be blocked
            if (!isReconnectionBlocked()) {
              attemptReconnection();
            } else {
              console.log('🚫 RECONNECTION: Fallback reconnection blocked - connection is established');
            }
          }
        }
      }, 10000, `ICE restart timeout (attempt ${currentAttempt})`); // 10 second timeout for ICE restart

      if (!iceRestartTimeout) {
        console.log('⏭️ ICE restart timeout blocked - connection already established');
      }

    } catch (error) {
      console.error('❌ RECONNECTION: Enhanced ICE restart failed:', error);

      // Fall back to full reconnection with relay mode
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS_CONST) {
        console.log('🔄 RECONNECTION: ICE restart failed, falling back to full reconnection with relay mode');
        setForceRelayMode(true);
        // Check if reconnection should be blocked
        if (!isReconnectionBlocked()) {
          attemptReconnection();
        } else {
          console.log('🚫 RECONNECTION: Fallback reconnection blocked - connection is established');
        }
      } else {
        const errorMessage = `❌ RECONNECTION: ICE restart and reconnection failed after multiple attempts.
        
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
        // Use protected addTrack method
        // Requirements: 3.4 - Block connection modification methods except getStats()
        const sender = protectedAddTrack(newPeerConnection, track, localStreamRef.current!);

        if (!sender) {
          console.error('❌ addTrack() blocked during peer connection recreation');
        }
      });
    }

    // Close old connection and replace
    if (peerConnectionRef.current) {
      // Use protected close method
      // Requirements: 3.4 - Allow close() for cleanup but log the action
      protectedClose(peerConnectionRef.current);
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
          console.log('❄️ ICE: TURN relay candidate discovered (' + relayCandidateCount + ') - ' + event.candidate.address + ':' + event.candidate.port);
        } else if (event.candidate.type === 'srflx') {
          srflxCandidateCount++;
          console.log('❄️ ICE: STUN srflx candidate discovered (' + srflxCandidateCount + ') - ' + event.candidate.address + ':' + event.candidate.port);
        } else {
          console.log('❄️ ICE: ' + event.candidate.type + ' candidate discovered - ' + event.candidate.address + ':' + event.candidate.port);
        }

        console.log('📤 SIGNALING: Sending ICE candidate to partner');
        socket.emit('ice-candidate', event.candidate.toJSON());
      } else {
        console.log('❄️ ICE: Gathering completed - ' + iceCandidateCount + ' total candidates (relay:' + relayCandidateCount + ', srflx:' + srflxCandidateCount + ')');

        // Critical: Warn if no relay candidates in restrictive network or when forced
        if ((networkType === 'restrictive' || forceRelayMode) && relayCandidateCount === 0) {
          console.error('❌ CRITICAL: No TURN relay candidates found!');
          console.error('This will cause connection failures in restrictive networks.');
          console.error('Check TURN server configuration and credentials.');

          // Force a reconnection with different TURN servers if available
          if (iceRestartAttempts < 2) {
            console.log('🔄 Attempting ICE restart to gather TURN candidates...');
            const iceRestartRetryTimeout = registerTimeout(() => handleEnhancedICERestart(), 2000, 'ICE restart retry for TURN candidates timeout');
            if (!iceRestartRetryTimeout) {
              console.log('⏭️ ICE restart retry timeout blocked - connection already established');
            }
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
      console.log('❄️ ICE GATHERING STATE: ' + peerConnection.iceGatheringState);

      if (peerConnection.iceGatheringState === 'gathering') {
        // Longer timeout for restrictive networks to allow TURN candidates
        const timeout = (networkType === 'restrictive' || forceRelayMode) ? 25000 : ICE_GATHERING_TIMEOUT_CONST;

        console.log(`❄️ ICE GATHERING: Timeout set to ${timeout}ms for network type: ${networkType}`);

        iceGatheringTimeout = registerTimeout(() => {
          console.log(`❄️ ICE GATHERING: Timeout after ${timeout}ms`);
          console.log(`❄️ ICE GATHERING: Final candidate count: ${iceCandidateCount} (${relayCandidateCount} relay, ${srflxCandidateCount} srflx)`);

          if (relayCandidateCount === 0 && (networkType === 'restrictive' || forceRelayMode)) {
            console.error('❌ ICE GATHERING: TURN gathering failed - no relay candidates after timeout');
          }
        }, timeout, `ICE gathering timeout (${networkType} network)`);

        if (!iceGatheringTimeout) {
          console.log('⏭️ ICE gathering timeout blocked - connection already established');
        }
      } else if (peerConnection.iceGatheringState === 'complete') {
        if (iceGatheringTimeout) {
          clearTimeout(iceGatheringTimeout);
          iceGatheringTimeout = null;
        }
      }
    };

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      console.log('📺 REMOTE STREAM: Track received - ' + event.track.kind + ' (' + event.track.label + ')');
      console.log('📺 REMOTE STREAM: Stream has ' + event.streams[0].getTracks().length + ' total tracks');

      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        console.log('📺 REMOTE STREAM: Stream attached to video element');

        // Log when first frame is received
        const handleFirstFrame = () => {
          console.log('🎉 REMOTE STREAM: First video frame received and displayed');
          remoteVideoRef.current?.removeEventListener('loadeddata', handleFirstFrame);
        };

        if (event.track.kind === 'video') {
          remoteVideoRef.current.addEventListener('loadeddata', handleFirstFrame);
        }
      }
    };

    // Handle connection state changes with detailed logging
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;

      switch (state) {
        case 'connecting':
          console.log('🟡 CONNECTION STATE: Connecting - WebRTC connection is being established');
          clearGraceTimers();
          break;
        case 'connected':
          console.log('🟢 CONNECTION STATE: Connected - WebRTC connection established successfully');
          setConnectionState('connected');
          setIsConnectionEstablished(true);
          setReconnectAttempts(0);
          setIsReconnecting(false);
          setIceRestartAttempts(0); // Reset ICE restart attempts on successful connection

          // CRITICAL: Freeze all network detection and timeout logic
          // The global authority flag is already set by WebRTCManager.monitorConnectionState
          freezeNetworkDetection();

          break;
        case 'disconnected':
          console.log('🟡 CONNECTION STATE: Disconnected - checking global authority flag');

          // ONLY trigger reconnection logic if we're in post-connection phase
          // AND this is an actual WebRTC failure, not a latency spike
          // Check the global authority flag to determine if connection was established
          if (WebRTCManager.getCallIsConnected() && connectionPhase === 'post-connection' && networkDetectionFrozen) {
            console.log('🟡 CONNECTION STATE: Post-connection disconnection detected - using grace period');
            setConnectionState('disconnected');

            if (!disconnectionGraceTimer && !isReconnecting) {
              console.log(`🟡 CONNECTION STATE: Starting ${DISCONNECTION_GRACE_PERIOD_CONST}ms grace period for disconnection`);
              const graceTimer = registerTimeout(() => {
                if (peerConnection.connectionState === 'disconnected') {
                  console.log('🟡 CONNECTION STATE: Grace period expired, attempting ICE restart first');
                  handleEnhancedICERestart(); // Try ICE restart before full reconnection
                }
                setDisconnectionGraceTimer(null);
              }, DISCONNECTION_GRACE_PERIOD_CONST, 'Disconnection grace period timer');

              if (graceTimer) {
                setDisconnectionGraceTimer(graceTimer);
              } else {
                console.log('⏭️ Disconnection grace timer blocked - connection already established');
              }
            }
          } else if (shouldRunPreConnectionLogic()) {
            console.log('🟡 CONNECTION STATE: Pre-connection disconnection - normal connection establishment process');
            setConnectionState('connecting'); // Stay in connecting state during initial setup
          } else {
            console.log('🟡 CONNECTION STATE: Ignoring disconnection - global authority flag indicates connection not established or network detection frozen');
          }
          break;
        case 'failed':
          console.log('🔴 CONNECTION STATE: Failed - checking global authority flag');

          // ONLY trigger reconnection logic if this is an actual WebRTC failure
          // Check the global authority flag to determine if connection was established
          if (WebRTCManager.getCallIsConnected() && connectionPhase === 'post-connection' && networkDetectionFrozen) {
            console.log('🔴 CONNECTION STATE: Post-connection failure detected - using grace period');
            setConnectionState('failed');

            if (!iceFailureGraceTimer && !isReconnecting) {
              console.log(`🔴 CONNECTION STATE: Starting ${ICE_FAILURE_GRACE_PERIOD_CONST}ms grace period for connection failure`);
              const graceTimer = registerTimeout(() => {
                if (peerConnection.connectionState === 'failed') {
                  console.log('🔴 CONNECTION STATE: Grace period expired, attempting ICE restart');
                  handleEnhancedICERestart(); // Try ICE restart before full reconnection
                }
                setIceFailureGraceTimer(null);
              }, ICE_FAILURE_GRACE_PERIOD_CONST, 'Connection failure grace period timer');

              if (graceTimer) {
                setIceFailureGraceTimer(graceTimer);
              } else {
                console.log('⏭️ Connection failure grace timer blocked - connection already established');
              }
            }
          } else if (shouldRunPreConnectionLogic()) {
            console.log('🔴 CONNECTION STATE: Pre-connection failure - normal connection establishment process');
            setConnectionState('connecting'); // Stay in connecting state during initial setup
            // Let the initial connection timeout handle this
          } else {
            console.log('🔴 CONNECTION STATE: Ignoring connection failure - global authority flag indicates connection not established or network detection frozen');
          }
          break;
        case 'closed':
          console.log('⚫ CONNECTION STATE: Closed - WebRTC connection closed');
          setConnectionState('disconnected');
          clearGraceTimers();
          break;
      }
    };

    // Handle ICE connection state changes with enhanced retry logic
    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;

      switch (iceState) {
        case 'checking':
          console.log('🟡 ICE STATE: Checking - ICE connectivity checks are in progress');
          clearGraceTimers();
          break;
        case 'connected':
          console.log('🟢 ICE STATE: Connected - ICE connectivity checks succeeded');
          setLastStableConnection(Date.now());
          clearGraceTimers();

          // CRITICAL: Also freeze on ICE connected
          // The global authority flag is already set by WebRTCManager.monitorConnectionState
          freezeNetworkDetection();

          break;
        case 'completed':
          console.log('🟢 ICE STATE: Completed - ICE connectivity checks completed successfully');
          setLastStableConnection(Date.now());
          clearGraceTimers();

          // CRITICAL: Also freeze on ICE completed
          // The global authority flag is already set by WebRTCManager.monitorConnectionState
          freezeNetworkDetection();

          break;
        case 'failed':
          console.log('🔴 ICE STATE: Failed - ICE connectivity checks failed, checking global authority flag');

          // ONLY trigger reconnection logic if this is an actual ICE failure in post-connection phase
          // Check the global authority flag to determine if connection was established
          if (WebRTCManager.getCallIsConnected() && connectionPhase === 'post-connection' && networkDetectionFrozen) {
            console.log('🔴 ICE STATE: Post-connection ICE failure detected - using grace period');

            if (!iceFailureGraceTimer && !isReconnecting) {
              console.log(`🔴 ICE STATE: Starting ${ICE_FAILURE_GRACE_PERIOD_CONST}ms grace period for ICE failure`);
              const graceTimer = registerTimeout(() => {
                if (peerConnection.iceConnectionState === 'failed') {
                  console.log('🔴 ICE STATE: ICE failure grace period expired, attempting enhanced ICE restart');
                  handleEnhancedICERestart();
                }
                setIceFailureGraceTimer(null);
              }, ICE_FAILURE_GRACE_PERIOD_CONST, 'ICE failure grace period timer');

              if (graceTimer) {
                setIceFailureGraceTimer(graceTimer);
              } else {
                console.log('⏭️ ICE failure grace timer blocked - connection already established');
              }
            }
          } else if (shouldRunPreConnectionLogic()) {
            console.log('🔴 ICE STATE: Pre-connection ICE failure - normal connection establishment process');
            // Let the initial connection timeout handle this
          } else {
            console.log('🔴 ICE STATE: Ignoring ICE failure - global authority flag indicates connection not established or network detection frozen');
          }
          break;
        case 'disconnected':
          console.log('🟡 ICE STATE: Disconnected - ICE connection disconnected, checking global authority flag');

          // ONLY trigger reconnection logic if this is an actual ICE disconnection in post-connection phase
          // Check the global authority flag to determine if connection was established
          if (WebRTCManager.getCallIsConnected() && connectionPhase === 'post-connection' && networkDetectionFrozen) {
            console.log('🟡 ICE STATE: Post-connection ICE disconnection detected - using grace period');

            if (!disconnectionGraceTimer && !isReconnecting) {
              console.log(`🟡 ICE STATE: Starting ${DISCONNECTION_GRACE_PERIOD_CONST}ms grace period for ICE disconnection`);
              const graceTimer = registerTimeout(() => {
                if (peerConnection.iceConnectionState === 'disconnected') {
                  console.log('🟡 ICE STATE: ICE disconnection grace period expired, attempting ICE restart');
                  handleEnhancedICERestart(); // Try ICE restart first
                }
                setDisconnectionGraceTimer(null);
              }, DISCONNECTION_GRACE_PERIOD_CONST, 'ICE disconnection grace period timer');

              if (graceTimer) {
                setDisconnectionGraceTimer(graceTimer);
              } else {
                console.log('⏭️ ICE disconnection grace timer blocked - connection already established');
              }
            }
          } else if (shouldRunPreConnectionLogic()) {
            console.log('🟡 ICE STATE: Pre-connection ICE disconnection - normal connection establishment process');
            // Let the initial connection timeout handle this
          } else {
            console.log('🟡 ICE STATE: Ignoring ICE disconnection - global authority flag indicates connection not established or network detection frozen');
          }
          break;
        case 'closed':
          console.log('⚫ ICE STATE: Closed - ICE connection closed');
          setConnectionState('disconnected');
          clearGraceTimers();
          break;
      }
    };

    // Handle signaling state changes
    peerConnection.onsignalingstatechange = () => {
      console.log('🔄 SIGNALING STATE: ' + peerConnection.signalingState);
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
    // CRITICAL: Block reconnection attempts when CALL_IS_CONNECTED = true
    // Requirements: 1.5, 3.5, 4.3, 4.4 - Prevent reconnection logic after connection
    if (isReconnectionBlocked()) {
      console.log('🚫 RECONNECTION: Reconnection attempt blocked - connection is established');
      return;
    }

    if (isReconnecting) {
      console.log('🔄 RECONNECTION: Reconnection already in progress, skipping duplicate attempt');
      return;
    }

    setIsReconnecting(true);
    const currentAttempt = reconnectAttempts + 1;
    setReconnectAttempts(currentAttempt);

    // Clear any existing grace timers and timeout timers to prevent conflicts
    clearGraceTimers();
    clearAllTimeoutTimers();

    console.log(`🔄 RECONNECTION: Attempting reconnection ${currentAttempt}/${MAX_RECONNECT_ATTEMPTS}`);

    // Implement proper exponential backoff with reasonable maximum delays
    const delay = calculateExponentialBackoffDelay(currentAttempt);

    console.log(`🔄 RECONNECTION: Exponential backoff - attempt=${currentAttempt}, delay=${delay}ms (max=${MAX_RECONNECT_DELAY_CONST}ms)`);

    // Wait before attempting reconnection
    await new Promise(resolve => {
      const reconnectionDelay = registerTimeout(() => resolve(undefined), delay, `Reconnection delay (attempt ${currentAttempt})`);
      if (!reconnectionDelay) {
        // If timeout is blocked, resolve immediately
        resolve(undefined);
      }
    });

    try {
      // Force relay mode after first failure in restrictive networks
      const shouldForceRelay = forceRelayMode ||
        networkType === 'restrictive' ||
        currentAttempt > 1;

      if (shouldForceRelay && !forceRelayMode) {
        console.log('🔒 RECONNECTION: Enabling relay mode for reconnection attempt');
        setForceRelayMode(true);
      }

      // Close existing peer connection
      if (peerConnectionRef.current) {
        // Use protected close method
        // Requirements: 3.4 - Allow close() for cleanup but log the action
        protectedClose(peerConnectionRef.current);
      }

      // Create new peer connection with enhanced error handling and network traversal
      const newPeerConnection = await createPeerConnection(shouldForceRelay);

      if (!newPeerConnection) {
        console.error('❌ RECONNECTION: Failed to create peer connection during reconnection - connection may already be established');
        setIsReconnecting(false);
        return;
      }

      peerConnectionRef.current = newPeerConnection;

      // Re-add local stream if available, otherwise try to get media again
      if (localStreamRef.current && localStreamRef.current.active) {
        localStreamRef.current.getTracks().forEach(track => {
          if (track.readyState === 'live') {
            // Use protected addTrack method
            // Requirements: 3.4 - Block connection modification methods except getStats()
            const sender = protectedAddTrack(newPeerConnection, track, localStreamRef.current!);

            if (!sender) {
              console.error('❌ RECONNECTION: addTrack() blocked during reconnection');
            }
          }
        });
      } else {
        console.log('🎥 RECONNECTION: Local stream not available, attempting to get media again');
        try {
          const stream = await getMediaStreamWithFallback();
          localStreamRef.current = stream;

          if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
          }

          stream.getTracks().forEach(track => {
            // Use protected addTrack method
            // Requirements: 3.4 - Block connection modification methods except getStats()
            const sender = protectedAddTrack(newPeerConnection, track, stream);

            if (!sender) {
              console.error('❌ RECONNECTION: addTrack() blocked during reconnection');
            }
          });
        } catch (mediaError) {
          console.error('❌ RECONNECTION: Failed to get media during reconnection:', mediaError);
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

        console.log(`🔄 RECONNECTION: Setting reconnection timeout: ${timeoutDuration}ms for attempt ${currentAttempt}`);

        const timeout = registerTimeout(() => {
          if (!isConnectionEstablished && connectionState !== 'connected') {
            // CRITICAL FIX: Only trigger timeout if ICE connection actually fails, not based on time elapsed
            const iceState = peerConnectionRef.current?.iceConnectionState;
            if (iceState === 'failed') {
              console.log(`⏰ RECONNECTION: Reconnection attempt ${currentAttempt} timed out with ICE failure`);
              if (timeout) {
                removeTimeoutTimer(timeout);
              }
              handleInitialConnectionTimeout();
            } else {
              console.log(`⏰ RECONNECTION: Reconnection timeout reached but ICE state is "${iceState}" - allowing connection to continue`);
            }
          }
        }, timeoutDuration, `Reconnection timeout (attempt ${currentAttempt})`);

        if (timeout) {
          setInitialConnectionTimeout(timeout);
          addTimeoutTimer(timeout);
        } else {
          console.log('⏭️ Reconnection timeout blocked - connection already established');
        }
      } else if (isConnectionEstablished) {
        console.log('🔄 RECONNECTION: Connection was previously established - no timeout for reconnection attempts');
      } else {
        console.log('🔄 RECONNECTION: Timeout timer already active, skipping duplicate timer creation');
      }

    } catch (error) {
      console.error(`❌ RECONNECTION: Reconnection attempt ${currentAttempt} failed:`, error);
      setIsReconnecting(false);

      if (currentAttempt >= MAX_RECONNECT_ATTEMPTS_CONST) {
        // Enhanced error handling for maximum retry scenarios
        const detailedError = `❌ RECONNECTION: Unable to reconnect after ${MAX_RECONNECT_ATTEMPTS_CONST} attempts. 
        
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
        console.log(`🔄 RECONNECTION: Scheduling next reconnection attempt in ${nextDelay}ms`);
        const nextAttemptTimeout = registerTimeout(() => {
          // Check if reconnection should be blocked before scheduling next attempt
          if (!isReconnectionBlocked()) {
            attemptReconnection();
          } else {
            console.log('🚫 RECONNECTION: Next reconnection attempt blocked - connection is established');
          }
        }, nextDelay, `Next reconnection attempt timeout (attempt ${currentAttempt + 1})`);

        if (!nextAttemptTimeout) {
          console.log('⏭️ Next reconnection attempt timeout blocked - connection already established');
        }
      }
    }
  };

  const retryConnection = () => {
    setReconnectAttempts(0);
    setIsReconnecting(false);
    setIsConnectionEstablished(false); // Reset connection establishment flag
    setNetworkDetectionFrozen(false); // Reset frozen state for retry
    setConnectionPhase('pre-connection'); // Reset to pre-connection phase
    setMediaError(null);
    initializeVideoChat();
  };

  // Targeted retry function for media access failures only
  const retryMediaAccess = async () => {
    console.log('🔄 RETRY: Attempting to retry media access only');
    setMediaError(null);

    try {
      // Stop existing stream if any
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }

      // Clear video element
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }

      // Reset media-related state
      setMediaReady(false);
      setUIReady(false);

      // Attempt media access again
      console.log('🎥 RETRY: Requesting camera access');
      const stream = await getMediaStreamWithFallback();

      // Attach to video element
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log('✅ RETRY: Local preview displayed');
      }

      // Store stream reference
      localStreamRef.current = stream;

      // Enable UI controls
      setUIReady(true);
      setMediaReady(true);

      console.log('✅ RETRY: Media access retry successful');

      // If we don't have a peer connection yet, continue with connection setup
      if (!peerConnectionRef.current && connectionState !== 'connected') {
        setConnectionState('connecting');

        // Initialize connection stream with the new media stream
        try {
          await initializeConnectionStream(stream);
        } catch (connectionError) {
          console.error('❌ RETRY: Connection setup failed after media retry:', connectionError);
          const errorMessage = connectionError instanceof Error ? connectionError.message : 'Failed to initialize connection';
          setMediaError(errorMessage);
        }
      }

    } catch (error) {
      const errorMessage = getMediaAccessErrorMessage(error);
      console.error('❌ RETRY: Media access retry failed:', errorMessage);
      setMediaError(errorMessage);
    }
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

    if (isSessionRestored && connectionState === 'matched') {
      return 'Restoring previous session...';
    }

    let baseStatus = '';
    switch (connectionState) {
      case 'matched':
        return 'Setting up camera and microphone...';
      case 'connecting':
        return 'Connecting to your partner...';
      case 'connected':
        baseStatus = partnerTemporarilyDisconnected ? 'Partner reconnected!' : 'Connected';
        break;
      case 'ended':
        return 'Call ended';
      default:
        return 'Unknown status';
    }

    // Add network quality indicator for connected state
    if (connectionState === 'connected') {
      const qualityText = networkQuality === 'good' ? '🟢' : networkQuality === 'fair' ? '🟡' : '🔴';
      const adaptiveText = adaptiveStreamingEnabled ? ' (Adaptive)' : '';
      const offlineText = !isOnline ? ' (Offline)' : '';
      const frozenText = networkDetectionFrozen ? ' 🔒' : '';
      return `${baseStatus} ${qualityText}${adaptiveText}${offlineText}${frozenText}`;
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

    if (isSessionRestored && connectionState === 'matched') {
      return 'text-blue-600';
    }

    switch (connectionState) {
      case 'matched':
      case 'connecting':
        return 'text-yellow-600';
      case 'connected':
        return 'text-green-600';
      case 'ended':
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
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
      <header className="bg-white text-gray-800 p-3 md:p-4 shadow-lg border-b border-gray-200">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          {/* Logo */}
          <div className="flex items-center">
            <Image
              src="/logoherored.png"
              alt="CampusCam"
              width={100}
              height={32}
              className="md:w-[120px] md:h-[40px]"
            />
          </div>

          {/* Session Timer and Status */}
          <div className="flex items-center space-x-2 md:space-x-4">
            {sessionStartTime && (
              <div className="flex items-center space-x-1 md:space-x-2">
                <div className="w-2 h-2 bg-[#FB2C36] rounded-full animate-pulse"></div>
                <span className="text-gray-800 font-mono text-sm md:text-lg">
                  {formatSessionDuration(sessionDuration)}
                </span>
              </div>
            )}

            {/* Connection Status */}
            <div className="flex items-center space-x-1 md:space-x-2">
              <div className={`w-2 h-2 md:w-3 md:h-3 rounded-full ${connectionState === 'connected' ? 'bg-green-500' :
                connectionState === 'connecting' || isReconnecting ? 'bg-orange-500 animate-pulse' :
                  'bg-red-500'
                }`}></div>
              <span className="text-xs md:text-sm text-gray-700 hidden sm:inline">
                {connectionState === 'connected' ? 'Connected' :
                  connectionState === 'connecting' || isReconnecting ? 'Connecting...' :
                    'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Video Content */}
      <div className="flex-1 flex items-center justify-center p-2 md:p-4 lg:p-6">
        <div className="max-w-7xl w-full h-full">
          {mediaError ? (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-4 md:px-6 md:py-4 rounded-xl text-center mx-2 md:mx-0">
              <h3 className="font-semibold mb-2 text-base md:text-lg">Media Access Error</h3>
              <p className="mb-4 text-red-600 text-sm md:text-base">{mediaError}</p>
              <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
                <button
                  onClick={retryMediaAccess}
                  className="bg-[#FB2C36] text-white px-4 py-2 md:px-6 md:py-2 rounded-lg hover:bg-[#E02329] transition-colors font-medium text-sm md:text-base"
                >
                  Try Again
                </button>
                <button
                  onClick={retryConnection}
                  className="bg-green-600 text-white px-4 py-2 md:px-6 md:py-2 rounded-lg hover:bg-green-700 transition-colors font-medium text-sm md:text-base"
                >
                  Full Retry
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="bg-gray-600 text-white px-4 py-2 md:px-6 md:py-2 rounded-lg hover:bg-gray-700 transition-colors font-medium text-sm md:text-base"
                >
                  Refresh Page
                </button>
              </div>
            </div>
          ) : connectionState === 'ended' && !isReconnecting ? (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-4 md:px-6 md:py-4 rounded-xl text-center mx-2 md:mx-0">
              <h3 className="font-semibold mb-2 text-base md:text-lg">Connection Failed</h3>
              <p className="text-yellow-700 text-sm md:text-base">Unable to establish video connection with your partner.</p>
              <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
                <button
                  onClick={retryConnection}
                  className="bg-[#FB2C36] text-white px-4 py-2 md:px-6 md:py-2 rounded-lg hover:bg-[#E02329] transition-colors font-medium text-sm md:text-base"
                >
                  Try Again
                </button>
                <button
                  onClick={endCall}
                  className="bg-gray-600 text-white px-4 py-2 md:px-6 md:py-2 rounded-lg hover:bg-gray-700 transition-colors font-medium text-sm md:text-base"
                >
                  End Call
                </button>
              </div>
            </div>
          ) : (
            /* Video Layout */
            <div className="px-3 md:px-0">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4 lg:gap-6 h-full min-h-[75vh] md:min-h-[70vh] max-w-full">
                {/* Partner Video (Left on Desktop, Top on Mobile) */}
                <div className="relative bg-white rounded-xl md:rounded-2xl overflow-hidden shadow-lg border border-gray-200 h-[35vh] md:h-auto w-full max-w-full">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 left-2 md:bottom-4 md:left-4 bg-[#FB2C36] bg-opacity-90 text-white px-2 py-1 md:px-3 md:py-1 rounded-md md:rounded-lg text-xs md:text-sm font-medium">
                    Partner
                  </div>

                  {/* Network Status Badge */}
                  <div className="absolute top-2 right-2 md:top-4 md:right-4">
                    <div className="flex flex-col gap-1 md:gap-2">
                      <div className={`px-1.5 py-0.5 md:px-2 md:py-1 rounded-md md:rounded-lg text-xs font-medium ${networkType === 'open' ? 'bg-green-100 text-green-800 border border-green-200' :
                        networkType === 'moderate' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' :
                          'bg-red-100 text-red-800 border border-red-200'
                        }`}>
                        {networkType === 'open' ? 'Good' : networkType === 'moderate' ? 'Fair' : 'Poor'}
                      </div>

                      {forceRelayMode && (
                        <div className="px-1.5 py-0.5 md:px-2 md:py-1 rounded-md md:rounded-lg text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                          Relay
                        </div>
                      )}

                      <div className={`px-1.5 py-0.5 md:px-2 md:py-1 rounded-md md:rounded-lg text-xs font-medium ${networkQuality === 'good' ? 'bg-green-100 text-green-800 border border-green-200' :
                        networkQuality === 'fair' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' :
                          'bg-red-100 text-red-800 border border-red-200'
                        }`}>
                        {networkQuality}
                      </div>
                    </div>
                  </div>

                  {(connectionState !== 'connected' || isReconnecting) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#FB2C36] bg-opacity-95">
                      <div className="text-center text-white px-4">
                        <div className="relative mb-3 md:mb-4">
                          <div className="animate-spin rounded-full h-8 w-8 md:h-12 md:w-12 border-3 md:border-4 border-white border-opacity-30 border-t-white mx-auto"></div>
                          <div className="absolute inset-0 animate-pulse">
                            <div className="w-8 h-8 md:w-12 md:h-12 rounded-full bg-white opacity-20 mx-auto"></div>
                          </div>
                        </div>
                        <p className="text-white font-medium text-sm md:text-base">
                          {isReconnecting ? `Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS_CONST})` : 'Connecting to partner...'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Your Video (Right on Desktop, Bottom on Mobile) */}
                <div className="relative bg-white rounded-xl md:rounded-2xl overflow-hidden shadow-lg border border-gray-200 h-[35vh] md:h-auto w-full max-w-full">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                  <div className="absolute bottom-2 left-2 md:bottom-4 md:left-4 bg-[#FB2C36] bg-opacity-90 text-white px-2 py-1 md:px-3 md:py-1 rounded-md md:rounded-lg text-xs md:text-sm font-medium">
                    You
                  </div>

                  {isVideoDisabled && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#FB2C36] bg-opacity-95">
                      <div className="text-center text-white px-4">
                        <div className="w-12 h-12 md:w-20 md:h-20 bg-white bg-opacity-20 rounded-full flex items-center justify-center mx-auto mb-2 md:mb-3">
                          <svg className="w-6 h-6 md:w-10 md:h-10 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <p className="text-white font-medium text-sm md:text-base">Camera Off</p>
                      </div>
                    </div>
                  )}

                  {/* Loading overlay for camera setup */}
                  {connectionState === 'matched' && !mediaReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#FB2C36] bg-opacity-95">
                      <div className="text-center text-white px-4">
                        <div className="relative mb-3 md:mb-4">
                          <div className="animate-spin rounded-full h-8 w-8 md:h-12 md:w-12 border-3 md:border-4 border-white border-opacity-30 border-t-white mx-auto"></div>
                          <div className="absolute inset-0 animate-pulse">
                            <div className="w-8 h-8 md:w-12 md:h-12 rounded-full bg-white opacity-20 mx-auto"></div>
                          </div>
                        </div>
                        <p className="text-white font-medium text-sm md:text-base">
                          Setting up camera...
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border-t border-gray-200 p-3 md:p-4 lg:p-6" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-6xl mx-auto flex justify-center items-center space-x-3 md:space-x-4 lg:space-x-6 flex-wrap gap-y-2">
          {/* Audio Toggle */}
          <button
            onClick={toggleAudio}
            disabled={!localStreamRef.current}
            className={`p-3 md:p-4 rounded-full transition-all duration-200 ${isAudioMuted
              ? 'bg-[#FB2C36] hover:bg-[#E02329] text-white shadow-lg'
              : 'bg-white hover:bg-gray-50 text-[#FB2C36] border-2 border-gray-200 hover:border-[#FB2C36]'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={isAudioMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 20 20">
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
            className={`p-3 md:p-4 rounded-full transition-all duration-200 ${isVideoDisabled
              ? 'bg-[#FB2C36] hover:bg-[#E02329] text-white shadow-lg'
              : 'bg-white hover:bg-gray-50 text-[#FB2C36] border-2 border-gray-200 hover:border-[#FB2C36]'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={isVideoDisabled ? 'Enable camera' : 'Disable camera'}
          >
            <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 24 24">
              {isVideoDisabled ? (
                // Camera off icon - crossed out camera
                <path d="M2.81 2.81a.996.996 0 0 0-1.41 0C1.01 3.2 1.01 3.83 1.4 4.22L2.81 5.63C2.3 6.27 2 7.09 2 8v8c0 1.1.9 2 2 2h12c.9 0 1.64-.35 2.22-.91l1.58 1.58c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41L2.81 2.81zM4 16V8c0-.55.45-1 1-1h.78l2 2H6v4c0 .55.45 1 1 1h8v-.78l2 2H4zm16-7.5c0-.83-.67-1.5-1.5-1.5S17 7.67 17 8.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7zM9.5 6L8 4.5 9.5 3h5L16 4.5 14.5 6h-5z" />
              ) : (
                // Camera on icon - proper video camera
                <path fillRule="evenodd" d="M14 7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7Zm2 9.387 4.684 1.562A1 1 0 0 0 22 17V7a1 1 0 0 0-1.316-.949L16 7.613v8.774Z" clipRule="evenodd" />
              )}
            </svg>
          </button>

          {/* End Call - Most Prominent */}
          <button
            onClick={endCall}
            className="p-4 md:p-5 rounded-full bg-[#FB2C36] hover:bg-[#E02329] text-white transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
            title="End call"
          >
            <svg className="w-6 h-6 md:w-7 md:h-7" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Skip User */}
          <button
            onClick={skipUser}
            className="p-3 md:p-4 rounded-full bg-gray-600 hover:bg-gray-700 text-white transition-all duration-200 shadow-md hover:shadow-lg"
            title="Skip to next user"
          >
            <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Report User */}
          <button
            onClick={reportUser}
            className="p-3 md:p-4 rounded-full bg-orange-500 hover:bg-orange-600 text-white transition-all duration-200 shadow-md hover:shadow-lg"
            title="Report user"
          >
            <svg className="w-5 h-5 md:w-6 md:h-6" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}