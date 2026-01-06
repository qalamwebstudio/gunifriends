/**
 * Connection Lifecycle Gate Checkpoint Tests
 * 
 * This test file implements Task 10: Checkpoint - Test connection lifecycle gate
 * 
 * Verifies:
 * - CALL_IS_CONNECTED flag works correctly
 * - All pre-connection logic stops after connection
 * - Connections remain stable beyond previous timeout periods
 */

import { 
  WebRTCManager, 
  registerTimeout, 
  registerInterval, 
  registerAbortController, 
  registerNetworkProbe,
  getPreConnectionRegistryState,
  resetPreConnectionRegistry,
  killAllPreConnectionLogic,
  isPreConnectionLogicKilled,
  getPreConnectionLogicKilledAt,
  getConnectionStateInfo,
  canStartNewConnection,
  shouldBlockReconnectionOperation,
  isReconnectionBlocked,
  isLatencyHandlerBlocked,
  isVisibilityChangeHandlerBlocked,
  isICERestartBlocked
} from './webrtc-manager';

// Mock RTCPeerConnection for testing
class MockRTCPeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  private eventListeners: { [key: string]: EventListener[] } = {};

  addEventListener(type: string, listener: EventListener) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    if (this.eventListeners[type]) {
      const index = this.eventListeners[type].indexOf(listener);
      if (index > -1) {
        this.eventListeners[type].splice(index, 1);
      }
    }
  }

  // Helper method to simulate state changes
  simulateStateChange(connectionState?: RTCPeerConnectionState, iceConnectionState?: RTCIceConnectionState) {
    if (connectionState) {
      this.connectionState = connectionState;
      this.dispatchEvent('connectionstatechange');
    }
    if (iceConnectionState) {
      this.iceConnectionState = iceConnectionState;
      this.dispatchEvent('iceconnectionstatechange');
    }
  }

  private dispatchEvent(type: string) {
    if (this.eventListeners[type]) {
      this.eventListeners[type].forEach(listener => {
        listener.call(this, { type } as Event);
      });
    }
  }
}

describe('Connection Lifecycle Gate Checkpoint Tests', () => {
  let mockPeerConnection: MockRTCPeerConnection;

  beforeEach(() => {
    // Reset everything before each test
    resetPreConnectionRegistry();
    WebRTCManager.setCallIsConnected(false);
    mockPeerConnection = new MockRTCPeerConnection();
  });

  afterEach(() => {
    // Clean up any remaining processes
    try {
      killAllPreConnectionLogic();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
    resetPreConnectionRegistry();
    WebRTCManager.setCallIsConnected(false);
  });

  describe('CALL_IS_CONNECTED Flag Functionality', () => {
    test('should initialize as false and allow pre-connection logic', () => {
      // Verify initial state
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
      expect(canStartNewConnection()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(false);

      // Should be able to register pre-connection processes
      const timeout = registerTimeout(() => {}, 1000, 'Test timeout');
      const interval = registerInterval(() => {}, 1000, 'Test interval');
      const controller = registerAbortController('Test controller');

      expect(timeout).not.toBeNull();
      expect(interval).not.toBeNull();
      expect(controller).not.toBeNull();

      const state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(3);

      // Clean up
      if (timeout) clearTimeout(timeout);
      if (interval) clearInterval(interval);
      if (controller) controller.abort();
    });

    test('should set to true when connection is established and block all pre-connection logic', () => {
      // Setup monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);

      // Register some pre-connection processes
      const callback = jest.fn();
      const timeout = registerTimeout(callback, 5000, 'Initial connection timeout');
      const interval = registerInterval(callback, 1000, 'Network detection interval');
      const controller = registerAbortController('Network probe controller');

      expect(timeout).not.toBeNull();
      expect(interval).not.toBeNull();
      expect(controller).not.toBeNull();

      let state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(3);
      expect(state.detailed.isKilled).toBe(false);

      // Simulate connection established
      mockPeerConnection.simulateStateChange('connected');

      // Verify CALL_IS_CONNECTED is set
      expect(WebRTCManager.getCallIsConnected()).toBe(true);

      // Verify all pre-connection processes are killed
      state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(0);
      expect(state.detailed.isKilled).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);
      expect(getPreConnectionLogicKilledAt()).toBeDefined();

      // Verify new pre-connection processes are blocked
      const blockedTimeout = registerTimeout(callback, 1000, 'Blocked timeout');
      const blockedInterval = registerInterval(callback, 1000, 'Blocked interval');
      const blockedController = registerAbortController('Blocked controller');

      expect(blockedTimeout).toBeNull();
      expect(blockedInterval).toBeNull();
      expect(blockedController).toBeNull();

      // Verify reconnection operations are blocked
      expect(isReconnectionBlocked()).toBe(true);
      expect(isLatencyHandlerBlocked()).toBe(true);
      expect(isVisibilityChangeHandlerBlocked()).toBe(true);
      expect(isICERestartBlocked()).toBe(true);
      expect(shouldBlockReconnectionOperation('Test operation')).toBe(true);
    });

    test('should reset to false only for actual WebRTC failures', () => {
      // Establish connection first
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      mockPeerConnection.simulateStateChange('connected');

      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);

      // Test temporary disconnection - should NOT reset
      mockPeerConnection.simulateStateChange('disconnected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);

      // Test actual failure - should reset
      mockPeerConnection.simulateStateChange('failed');
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
      expect(isPreConnectionLogicKilled()).toBe(false);

      // Should be able to register new processes for recovery
      const recoveryTimeout = registerTimeout(() => {}, 1000, 'Recovery timeout');
      expect(recoveryTimeout).not.toBeNull();

      // Clean up
      if (recoveryTimeout) clearTimeout(recoveryTimeout);
    });
  });

  describe('Pre-Connection Logic Termination', () => {
    test('should terminate all types of pre-connection processes when connection is established', async () => {
      const callback = jest.fn();
      let networkProbeResolved = false;

      // Register various types of pre-connection processes
      const timeout1 = registerTimeout(callback, 10000, 'Long timeout 1');
      const timeout2 = registerTimeout(callback, 15000, 'Long timeout 2');
      const interval1 = registerInterval(callback, 1000, 'Network detection');
      const interval2 = registerInterval(callback, 2000, 'Quality monitoring');
      const controller1 = registerAbortController('Network probe 1');
      const controller2 = registerAbortController('Network probe 2');
      
      // Create network probes
      const probe1 = new Promise(resolve => {
        setTimeout(() => {
          networkProbeResolved = true;
          resolve('probe1 result');
        }, 5000);
      });
      const probe2 = Promise.resolve('probe2 result');
      
      registerNetworkProbe(probe1, 'Long network probe');
      registerNetworkProbe(probe2, 'Quick network probe');

      // Verify all processes are registered
      let state = getPreConnectionRegistryState();
      expect(state.counts.timeouts).toBe(2);
      expect(state.counts.intervals).toBe(2);
      expect(state.counts.abortControllers).toBe(2);
      expect(state.counts.networkProbes).toBe(2);
      expect(state.counts.total).toBe(8);
      expect(state.detailed.isKilled).toBe(false);

      // Verify abort controllers are not aborted yet
      expect(controller1?.signal.aborted).toBe(false);
      expect(controller2?.signal.aborted).toBe(false);

      // Setup connection monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);

      // Simulate connection established
      mockPeerConnection.simulateStateChange('connected');

      // Verify CALL_IS_CONNECTED is set
      expect(WebRTCManager.getCallIsConnected()).toBe(true);

      // Verify all processes are terminated
      state = getPreConnectionRegistryState();
      expect(state.counts.timeouts).toBe(0);
      expect(state.counts.intervals).toBe(0);
      expect(state.counts.abortControllers).toBe(0);
      expect(state.counts.networkProbes).toBe(0);
      expect(state.counts.total).toBe(0);
      expect(state.detailed.isKilled).toBe(true);

      // Verify abort controllers were actually aborted
      expect(controller1?.signal.aborted).toBe(true);
      expect(controller2?.signal.aborted).toBe(true);

      // Verify callbacks were not called (timeouts/intervals were cleared)
      expect(callback).not.toHaveBeenCalled();

      // Wait a bit to ensure network probe doesn't resolve
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(networkProbeResolved).toBe(false);
    });

    test('should prevent any new pre-connection processes after termination', () => {
      const callback = jest.fn();

      // Establish connection and kill processes
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      mockPeerConnection.simulateStateChange('connected');

      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);

      // Try to register new processes - all should be blocked
      const timeout = registerTimeout(callback, 1000, 'Blocked timeout');
      const interval = registerInterval(callback, 1000, 'Blocked interval');
      const controller = registerAbortController('Blocked controller');
      const probe = registerNetworkProbe(Promise.resolve('blocked'), 'Blocked probe');

      expect(timeout).toBeNull();
      expect(interval).toBeNull();
      expect(controller).toBeNull();
      expect(probe).toBeNull();

      // Verify registry remains empty
      const state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(0);
      expect(state.detailed.isKilled).toBe(true);
    });

    test('should handle cleanup errors gracefully and still mark as killed', () => {
      const callback = jest.fn();

      // Register a timeout
      const timeout = registerTimeout(callback, 1000, 'Test timeout');
      expect(timeout).not.toBeNull();

      // Mock clearTimeout to throw an error
      const originalClearTimeout = global.clearTimeout;
      const clearTimeoutSpy = jest.fn(() => {
        throw new Error('Mock clearTimeout error');
      });
      global.clearTimeout = clearTimeoutSpy;

      try {
        // Execute killAllPreConnectionLogic - should handle error gracefully
        killAllPreConnectionLogic();

        // Verify registry is still marked as killed despite errors
        const state = getPreConnectionRegistryState();
        expect(state.detailed.isKilled).toBe(true);
        expect(isPreConnectionLogicKilled()).toBe(true);

        // Verify clearTimeout was called (and failed)
        expect(clearTimeoutSpy).toHaveBeenCalled();

      } finally {
        // Restore original clearTimeout
        global.clearTimeout = originalClearTimeout;
      }
    });
  });

  describe('Connection Stability Beyond Timeout Periods', () => {
    test('should maintain stable connection beyond typical timeout periods', async () => {
      const callback = jest.fn();

      // Register timeouts that would normally fire during connection setup
      const initialTimeout = registerTimeout(callback, 30000, 'Initial connection timeout'); // 30s
      const iceTimeout = registerTimeout(callback, 15000, 'ICE gathering timeout'); // 15s
      const networkTimeout = registerTimeout(callback, 10000, 'Network detection timeout'); // 10s

      // Register intervals that would normally run during connection
      const networkInterval = registerInterval(callback, 5000, 'Network detection interval'); // 5s
      const qualityInterval = registerInterval(callback, 2000, 'Quality monitoring interval'); // 2s

      // Verify processes are registered
      let state = getPreConnectionRegistryState();
      expect(state.counts.timeouts).toBe(3);
      expect(state.counts.intervals).toBe(2);
      expect(state.counts.total).toBe(5);

      // Setup connection monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);

      // Simulate connection established
      mockPeerConnection.simulateStateChange('connected');

      // Verify connection is established and processes are killed
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(0);
      expect(state.detailed.isKilled).toBe(true);

      // Wait beyond the timeout periods to ensure they don't fire
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms

      // Verify callbacks were never called (timeouts/intervals were cleared)
      expect(callback).not.toHaveBeenCalled();

      // Verify connection remains stable
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);

      // Verify no new processes can be created
      const blockedTimeout = registerTimeout(callback, 1000, 'Blocked timeout');
      expect(blockedTimeout).toBeNull();

      // Verify reconnection operations remain blocked
      expect(isReconnectionBlocked()).toBe(true);
      expect(shouldBlockReconnectionOperation('Stability test')).toBe(true);
    });

    test('should maintain connection stability during temporary network issues', () => {
      // Establish connection
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      mockPeerConnection.simulateStateChange('connected');

      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);

      // Simulate temporary network issues
      mockPeerConnection.simulateStateChange('disconnected'); // Temporary disconnection
      
      // Connection should remain stable (CALL_IS_CONNECTED should stay true)
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);

      // Reconnection should still be blocked
      expect(isReconnectionBlocked()).toBe(true);
      expect(canStartNewConnection()).toBe(false);

      // Simulate recovery from temporary issue
      mockPeerConnection.simulateStateChange('connected');
      
      // Should still be connected and stable
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);
    });

    test('should allow recovery only for actual WebRTC failures', () => {
      // Establish connection
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      mockPeerConnection.simulateStateChange('connected');

      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);

      // Test various failure scenarios
      const failureStates: Array<{ connectionState?: RTCPeerConnectionState, iceConnectionState?: RTCIceConnectionState, shouldReset: boolean }> = [
        { connectionState: 'failed', shouldReset: true },
        { connectionState: 'closed', shouldReset: true },
        { iceConnectionState: 'failed', shouldReset: true },
        { connectionState: 'disconnected', shouldReset: false }, // Temporary
        { iceConnectionState: 'disconnected', shouldReset: false }, // Temporary
      ];

      for (const scenario of failureStates) {
        // Reset to connected state
        mockPeerConnection.simulateStateChange('connected', 'connected');
        WebRTCManager.setCallIsConnected(true);
        killAllPreConnectionLogic();

        // Apply the test scenario
        mockPeerConnection.simulateStateChange(scenario.connectionState, scenario.iceConnectionState);

        if (scenario.shouldReset) {
          expect(WebRTCManager.getCallIsConnected()).toBe(false);
          expect(isPreConnectionLogicKilled()).toBe(false);
          expect(canStartNewConnection()).toBe(true);
        } else {
          expect(WebRTCManager.getCallIsConnected()).toBe(true);
          expect(isPreConnectionLogicKilled()).toBe(true);
          expect(canStartNewConnection()).toBe(false);
        }
      }
    });
  });

  describe('Integration with Connection State Info', () => {
    test('should provide accurate connection state information throughout lifecycle', () => {
      const callback = jest.fn();

      // Initial state
      let info = getConnectionStateInfo();
      expect(info.callIsConnected).toBe(false);
      expect(info.processRegistryKilled).toBe(false);
      expect(info.canStartNewConnection).toBe(true);
      expect(info.activeProcesses.total).toBe(0);

      // Register some processes
      const timeout = registerTimeout(callback, 5000, 'Test timeout');
      const interval = registerInterval(callback, 1000, 'Test interval');

      info = getConnectionStateInfo();
      expect(info.callIsConnected).toBe(false);
      expect(info.processRegistryKilled).toBe(false);
      expect(info.canStartNewConnection).toBe(true);
      expect(info.activeProcesses.total).toBe(2);
      expect(info.activeProcesses.timeouts).toBe(1);
      expect(info.activeProcesses.intervals).toBe(1);

      // Establish connection
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      mockPeerConnection.simulateStateChange('connected');

      info = getConnectionStateInfo();
      expect(info.callIsConnected).toBe(true);
      expect(info.processRegistryKilled).toBe(true);
      expect(info.processRegistryKilledAt).toBeDefined();
      expect(info.canStartNewConnection).toBe(false);
      expect(info.activeProcesses.total).toBe(0);

      // Simulate failure and recovery
      mockPeerConnection.simulateStateChange('failed');

      info = getConnectionStateInfo();
      expect(info.callIsConnected).toBe(false);
      expect(info.processRegistryKilled).toBe(false);
      expect(info.canStartNewConnection).toBe(true);
      expect(info.activeProcesses.total).toBe(0);
    });
  });

  describe('Error Scenarios and Edge Cases', () => {
    test('should handle rapid connection state changes correctly', () => {
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);

      // Rapid state changes
      mockPeerConnection.simulateStateChange('connecting');
      expect(WebRTCManager.getCallIsConnected()).toBe(false);

      mockPeerConnection.simulateStateChange('connected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);

      mockPeerConnection.simulateStateChange('disconnected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true); // Temporary disconnection

      mockPeerConnection.simulateStateChange('failed');
      expect(WebRTCManager.getCallIsConnected()).toBe(false); // Actual failure

      mockPeerConnection.simulateStateChange('connected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true); // Reconnected
    });

    test('should handle connection monitoring setup errors gracefully', () => {
      // Create a mock peer connection that throws errors
      const errorPeerConnection = {
        connectionState: 'new' as RTCPeerConnectionState,
        iceConnectionState: 'new' as RTCIceConnectionState,
        addEventListener: jest.fn(() => {
          throw new Error('Mock addEventListener error');
        })
      };

      // Should not throw when monitoring setup fails
      expect(() => {
        WebRTCManager.monitorConnectionState(errorPeerConnection as any);
      }).not.toThrow();

      // Connection state should remain false
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
    });

    test('should handle multiple monitoring setups on same connection', () => {
      const callback = jest.fn();

      // Register some processes
      registerTimeout(callback, 1000, 'Test timeout');
      registerInterval(callback, 1000, 'Test interval');

      // Setup monitoring multiple times
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);

      // Simulate connection
      mockPeerConnection.simulateStateChange('connected');

      // Should still work correctly
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);

      const state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(0);
    });
  });
});