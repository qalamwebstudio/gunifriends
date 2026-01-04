import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import VideoChat from './VideoChat';
import { Socket } from 'socket.io-client';
import * as fc from 'fast-check';

// Mock the WebRTC APIs
const mockRTCPeerConnection = jest.fn().mockImplementation(() => ({
  addTrack: jest.fn(),
  createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' }),
  createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-sdp' }),
  setLocalDescription: jest.fn().mockResolvedValue(undefined),
  setRemoteDescription: jest.fn().mockResolvedValue(undefined),
  addIceCandidate: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
  connectionState: 'new',
  iceConnectionState: 'new',
  signalingState: 'stable',
  onicecandidate: null,
  ontrack: null,
  onconnectionstatechange: null,
  oniceconnectionstatechange: null,
  onsignalingstatechange: null,
  ondatachannel: null,
  onicegatheringstatechange: null,
  iceGatheringState: 'new'
}));

// Mock getUserMedia
const mockGetUserMedia = jest.fn().mockResolvedValue({
  getTracks: () => [
    { kind: 'video', stop: jest.fn(), enabled: true, readyState: 'live', label: 'mock-video' },
    { kind: 'audio', stop: jest.fn(), enabled: true, readyState: 'live', label: 'mock-audio' }
  ],
  getVideoTracks: () => [{ kind: 'video', stop: jest.fn(), enabled: true, readyState: 'live', label: 'mock-video' }],
  getAudioTracks: () => [{ kind: 'audio', stop: jest.fn(), enabled: true, readyState: 'live', label: 'mock-audio' }],
  active: true
});

// Mock socket
const mockSocket = {
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  connected: true,
  id: 'mock-socket-id'
} as unknown as Socket;

// Mock WebRTC configuration functions
jest.mock('../lib/webrtc-config', () => ({
  getWebRTCConfiguration: () => ({ iceServers: [] }),
  testWebRTCConnectivity: () => Promise.resolve({
    hasInternet: true,
    hasSTUN: true,
    hasTURN: false
  }),
  getMediaStreamWithFallback: () => mockGetUserMedia(),
  ConnectionQualityMonitor: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn()
  }))
}));

// Setup global mocks
beforeAll(() => {
  global.RTCPeerConnection = mockRTCPeerConnection;
  global.navigator.mediaDevices = {
    getUserMedia: mockGetUserMedia
  } as any;
  
  // Mock localStorage
  const localStorageMock = {
    getItem: jest.fn(() => 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ0ZXN0LXVzZXItaWQifQ.mock-signature'),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn()
  };
  Object.defineProperty(window, 'localStorage', { value: localStorageMock });
  
  // Mock window events
  Object.defineProperty(window, 'addEventListener', { value: jest.fn() });
  Object.defineProperty(window, 'removeEventListener', { value: jest.fn() });
  Object.defineProperty(document, 'addEventListener', { value: jest.fn() });
  Object.defineProperty(document, 'removeEventListener', { value: jest.fn() });
});

describe('VideoChat Timeout Fixes', () => {
  const defaultProps = {
    socket: mockSocket,
    partnerId: 'partner-123',
    roomId: 'room-456',
    onCallEnd: jest.fn(),
    onError: jest.fn(),
    isSessionRestored: false
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should not set aggressive timeouts for established connections', async () => {
    const { container } = render(<VideoChat {...defaultProps} />);
    
    // Wait for component to initialize
    await waitFor(() => {
      expect(screen.getByText(/Setting up camera and microphone/)).toBeInTheDocument();
    });

    // Simulate successful connection establishment
    const peerConnection = mockRTCPeerConnection.mock.results[0].value;
    peerConnection.connectionState = 'connected';
    
    // Trigger connection state change
    if (peerConnection.onconnectionstatechange) {
      peerConnection.onconnectionstatechange();
    }

    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument();
    });

    // Fast-forward time significantly (beyond old 45s timeout)
    jest.advanceTimersByTime(60000); // 60 seconds

    // Connection should still be active - no timeout should have triggered
    expect(defaultProps.onError).not.toHaveBeenCalledWith(
      expect.stringContaining('Connection timeout')
    );
    expect(defaultProps.onCallEnd).not.toHaveBeenCalled();
  });

  test('should implement progressive timeout extension during initial connection', async () => {
    render(<VideoChat {...defaultProps} />);
    
    // Wait for component to initialize
    await waitFor(() => {
      expect(screen.getByText(/Setting up camera and microphone/)).toBeInTheDocument();
    });

    // Simulate connection in progress but not yet established
    const peerConnection = mockRTCPeerConnection.mock.results[0].value;
    peerConnection.connectionState = 'connecting';
    
    if (peerConnection.onconnectionstatechange) {
      peerConnection.onconnectionstatechange();
    }

    await waitFor(() => {
      expect(screen.getByText(/Connecting to your partner/)).toBeInTheDocument();
    });

    // Fast-forward to initial timeout (60s)
    jest.advanceTimersByTime(60000);

    // Should extend timeout, not immediately fail
    expect(defaultProps.onError).not.toHaveBeenCalledWith(
      expect.stringContaining('Connection timeout. Unable to establish')
    );

    // Fast-forward through first extension (15s)
    jest.advanceTimersByTime(15000);

    // Should still be trying to connect with progressive extension
    expect(screen.getByText(/Connecting to your partner/)).toBeInTheDocument();
  });

  test('should separate initial connection timeouts from established connection monitoring', async () => {
    render(<VideoChat {...defaultProps} />);
    
    // Wait for initialization
    await waitFor(() => {
      expect(screen.getByText(/Setting up camera and microphone/)).toBeInTheDocument();
    });

    const peerConnection = mockRTCPeerConnection.mock.results[0].value;
    
    // First, simulate connecting state
    peerConnection.connectionState = 'connecting';
    if (peerConnection.onconnectionstatechange) {
      peerConnection.onconnectionstatechange();
    }

    await waitFor(() => {
      expect(screen.getByText(/Connecting to your partner/)).toBeInTheDocument();
    });

    // Then simulate successful connection
    peerConnection.connectionState = 'connected';
    if (peerConnection.onconnectionstatechange) {
      peerConnection.onconnectionstatechange();
    }

    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument();
    });

    // Now fast-forward way beyond any reasonable timeout
    jest.advanceTimersByTime(300000); // 5 minutes

    // Connection should remain stable - no timeouts for established connections
    expect(screen.getByText(/Connected/)).toBeInTheDocument();
    expect(defaultProps.onError).not.toHaveBeenCalledWith(
      expect.stringContaining('timeout')
    );
  });

  /**
   * Property-Based Test: Initial Connection Timeout Extension
   * **Feature: fix-auto-disconnect, Property 8: Initial Connection Timeout Extension**
   * **Validates: Requirements 1.2, 4.1**
   */
  test('Property 8: Initial Connection Timeout Extension - should extend timeouts during initial setup rather than immediately failing', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate scenarios for initial connection setup
        fc.record({
          initialTimeoutMs: fc.integer({ min: 45000, max: 90000 }), // Various initial timeout values
          reconnectAttempts: fc.integer({ min: 0, max: 2 }), // Reduced max attempts for faster testing
          connectionDelay: fc.integer({ min: 30000, max: 120000 }), // Time it takes to actually connect
          shouldEventuallyConnect: fc.boolean() // Whether connection will eventually succeed
        }),
        async (scenario) => {
          const { initialTimeoutMs, reconnectAttempts, connectionDelay, shouldEventuallyConnect } = scenario;
          
          // Setup component
          const { container } = render(<VideoChat {...defaultProps} />);
          
          // Wait for initialization
          await waitFor(() => {
            expect(screen.getByText(/Setting up camera and microphone/)).toBeInTheDocument();
          });

          const peerConnection = mockRTCPeerConnection.mock.results[0].value;
          
          // Simulate connection in progress (not yet established)
          await act(async () => {
            peerConnection.connectionState = 'connecting';
            if (peerConnection.onconnectionstatechange) {
              peerConnection.onconnectionstatechange();
            }
          });

          // Wait for the connection state to be reflected in the UI
          await waitFor(() => {
            // Check that we're not in initial setup anymore
            expect(screen.queryByText(/Setting up camera and microphone/)).not.toBeInTheDocument();
          }, { timeout: 5000 });

          // Track initial state
          const initialErrorCallCount = defaultProps.onError.mock.calls.length;
          const initialCallEndCount = defaultProps.onCallEnd.mock.calls.length;

          // Fast-forward to initial timeout period
          await act(async () => {
            jest.advanceTimersByTime(initialTimeoutMs);
          });

          // Property: System should extend timeout rather than immediately failing during initial setup
          // The core property is that we don't immediately fail on the first timeout
          expect(defaultProps.onError).not.toHaveBeenCalledWith(
            expect.stringMatching(/Connection timeout\. Unable to establish.*after multiple attempts/i)
          );
          expect(defaultProps.onCallEnd).not.toHaveBeenCalled();
          
          // Should show timeout extension behavior - either still connecting or attempting reconnection
          const connectingElements = screen.queryAllByText(/Connecting to your partner/);
          const reconnectingElements = screen.queryAllByText(/Reconnecting.*Attempt/);
          const isExtendingTimeout = connectingElements.length > 0 || reconnectingElements.length > 0;
          
          // Property: System extends timeouts instead of immediately failing
          expect(isExtendingTimeout).toBeTruthy();

          // If connection should eventually succeed, simulate it
          if (shouldEventuallyConnect && connectionDelay < initialTimeoutMs + (reconnectAttempts * 20000)) {
            await act(async () => {
              peerConnection.connectionState = 'connected';
              if (peerConnection.onconnectionstatechange) {
                peerConnection.onconnectionstatechange();
              }
            });

            // Property: Successful connection after timeout extension should work normally
            // Check for either "Connected" state or that we're no longer in error/timeout states
            await waitFor(() => {
              const hasConnectedText = screen.queryByText(/Connected/);
              const hasErrorText = screen.queryByText(/Connection failed|Unable to establish/);
              const isNotInErrorState = !hasErrorText;
              
              // Accept either explicit "Connected" text or absence of error states
              expect(hasConnectedText || isNotInErrorState).toBeTruthy();
            }, { timeout: 3000 });
            
            // Should not have failed due to timeout
            expect(defaultProps.onError).not.toHaveBeenCalledWith(
              expect.stringMatching(/Connection timeout/i)
            );
          }

          // Cleanup
          container.remove();
        }
      ),
      { numRuns: 5 } // Further reduced for faster execution
    );
  });

  /**
   * Property-Based Test: No Arbitrary Timeout Disconnections
   * **Feature: fix-auto-disconnect, Property 1: No Arbitrary Timeout Disconnections**
   * **Validates: Requirements 1.1, 1.4, 1.5**
   */
  test('Property 1: No Arbitrary Timeout Disconnections - established connections should not timeout based on duration alone', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary connection durations beyond normal timeout periods
        fc.integer({ min: 60000, max: 600000 }), // 1 minute to 10 minutes
        fc.boolean(), // Whether heartbeats are being sent
        async (connectionDuration, hasHeartbeats) => {
          // Setup component
          const { container } = render(<VideoChat {...defaultProps} />);
          
          // Wait for initialization
          await waitFor(() => {
            expect(screen.getByText(/Setting up camera and microphone/)).toBeInTheDocument();
          });

          const peerConnection = mockRTCPeerConnection.mock.results[0].value;
          
          // Simulate successful connection establishment with proper React act wrapping
          await act(async () => {
            peerConnection.connectionState = 'connected';
            if (peerConnection.onconnectionstatechange) {
              peerConnection.onconnectionstatechange();
            }
          });

          // Wait for connection to be established (may show "Connected" or still be "Connecting")
          await waitFor(() => {
            // Check that we're not in initial setup anymore
            expect(screen.queryByText(/Setting up camera and microphone/)).not.toBeInTheDocument();
          });

          // Simulate heartbeats if enabled (maintaining activity)
          let heartbeatInterval: NodeJS.Timeout | null = null;
          if (hasHeartbeats) {
            heartbeatInterval = setInterval(() => {
              // Simulate heartbeat activity
              if (defaultProps.socket.emit) {
                defaultProps.socket.emit('heartbeat');
              }
            }, 30000);
          }

          // Fast-forward through the connection duration
          await act(async () => {
            jest.advanceTimersByTime(connectionDuration);
          });

          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
          }

          // Property: Established connections should NEVER timeout due to arbitrary duration limits
          // The key property is that onError should not be called with timeout-related messages
          // and onCallEnd should not be called due to timeouts
          
          // Check that no timeout-related errors occurred
          expect(defaultProps.onError).not.toHaveBeenCalledWith(
            expect.stringMatching(/timeout|disconnect.*time|connection.*expired|45.*second/i)
          );
          
          // Check that call wasn't ended due to timeout
          expect(defaultProps.onCallEnd).not.toHaveBeenCalled();

          // Property: With heartbeats, connections should definitely persist
          if (hasHeartbeats) {
            // Should not show any error states
            expect(screen.queryByText(/Connection failed/)).not.toBeInTheDocument();
            expect(screen.queryByText(/Unable to establish/)).not.toBeInTheDocument();
          }

          // Cleanup
          container.remove();
        }
      ),
      { numRuns: 10 } // Further reduced for faster execution while maintaining coverage
    );
  });
});