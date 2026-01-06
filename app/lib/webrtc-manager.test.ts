/**
 * WebRTC Manager Tests
 * Tests for the global connection authority flag implementation
 */

import { 
  WebRTCManager, 
  registerTimeout, 
  registerInterval, 
  registerAbortController, 
  registerNetworkProbe,
  unregisterTimeout,
  unregisterInterval,
  unregisterAbortController,
  getPreConnectionRegistryState,
  resetPreConnectionRegistry,
  killAllPreConnectionLogic,
  isPreConnectionLogicKilled,
  getPreConnectionLogicKilledAt,
  isActualWebRTCFailure,
  isTemporaryDisconnection,
  shouldAllowRecovery,
  resetConnectionStateForRecovery,
  canStartNewConnection,
  getConnectionStateInfo
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

describe('WebRTC Manager - Global Connection Authority Flag', () => {
  let mockPeerConnection: MockRTCPeerConnection;

  beforeEach(() => {
    // Reset the global flag before each test
    WebRTCManager.setCallIsConnected(false);
    mockPeerConnection = new MockRTCPeerConnection();
  });

  describe('Global Authority Flag Management', () => {
    test('should initialize CALL_IS_CONNECTED as false', () => {
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
    });

    test('should set CALL_IS_CONNECTED to true', () => {
      WebRTCManager.setCallIsConnected(true);
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
    });

    test('should set CALL_IS_CONNECTED to false', () => {
      WebRTCManager.setCallIsConnected(true);
      WebRTCManager.setCallIsConnected(false);
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
    });
  });

  describe('Connection State Monitoring', () => {
    test('should set CALL_IS_CONNECTED to true when connectionState becomes connected', () => {
      // Setup monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      
      // Simulate connection established
      mockPeerConnection.simulateStateChange('connected');
      
      // Verify flag is set
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
    });

    test('should set CALL_IS_CONNECTED to true when iceConnectionState becomes connected', () => {
      // Setup monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      
      // Simulate ICE connection established
      mockPeerConnection.simulateStateChange(undefined, 'connected');
      
      // Verify flag is set
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
    });

    test('should set CALL_IS_CONNECTED to false when connectionState becomes failed', () => {
      // Setup monitoring and establish connection first
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      mockPeerConnection.simulateStateChange('connected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Simulate connection failure
      mockPeerConnection.simulateStateChange('failed');
      
      // Verify flag is reset
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
    });

    test('should set CALL_IS_CONNECTED to false when connectionState becomes closed', () => {
      // Setup monitoring and establish connection first
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      mockPeerConnection.simulateStateChange('connected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Simulate connection closed
      mockPeerConnection.simulateStateChange('closed');
      
      // Verify flag is reset
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
    });

    test('should not reset CALL_IS_CONNECTED for temporary disconnections', () => {
      // Setup monitoring and establish connection first
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      mockPeerConnection.simulateStateChange('connected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Simulate temporary disconnection
      mockPeerConnection.simulateStateChange('disconnected');
      
      // Verify flag remains true (temporary disconnections should not reset the flag)
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
    });

    test('should handle multiple state changes correctly', () => {
      // Setup monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      
      // Initial state
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
      
      // Connection established
      mockPeerConnection.simulateStateChange('connected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Temporary disconnection (should not reset)
      mockPeerConnection.simulateStateChange('disconnected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Actual failure (should reset)
      mockPeerConnection.simulateStateChange('failed');
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
      
      // Reconnection
      mockPeerConnection.simulateStateChange('connected');
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
    });

    test('should only set flag once when both connectionState and iceConnectionState become connected', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // Setup monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      
      // Simulate both states becoming connected
      mockPeerConnection.simulateStateChange('connected', 'connected');
      
      // Verify flag is set
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Verify the connection established message appears only once
      const connectionMessages = consoleSpy.mock.calls.filter(call => 
        call[0]?.includes('🔗 Connection established')
      );
      expect(connectionMessages).toHaveLength(1);
      
      consoleSpy.mockRestore();
    });
  });

  describe('WebRTCManager Basic Functionality', () => {
    let manager: WebRTCManager;

    beforeEach(() => {
      manager = new WebRTCManager();
    });

    test('should create a new connection', () => {
      const connection = manager.createConnection('room1', 'user1', 'user2');
      
      expect(connection.id).toBe('room1');
      expect(connection.user1Id).toBe('user1');
      expect(connection.user2Id).toBe('user2');
      expect(connection.state).toBe('new');
    });

    test('should update connection state', () => {
      manager.createConnection('room1', 'user1', 'user2');
      
      const updated = manager.updateConnectionState('room1', 'connected');
      expect(updated).toBe(true);
      
      const connection = manager.getConnection('room1');
      expect(connection?.state).toBe('connected');
      expect(connection?.connectedAt).toBeDefined();
    });

    test('should get connection by user ID', () => {
      manager.createConnection('room1', 'user1', 'user2');
      
      const connection1 = manager.getConnectionByUserId('user1');
      const connection2 = manager.getConnectionByUserId('user2');
      const connection3 = manager.getConnectionByUserId('user3');
      
      expect(connection1?.id).toBe('room1');
      expect(connection2?.id).toBe('room1');
      expect(connection3).toBeNull();
    });
  });

  describe('Pre-Connection Process Registry', () => {
    beforeEach(() => {
      // Reset registry and connection state before each test
      resetPreConnectionRegistry();
      WebRTCManager.setCallIsConnected(false);
    });

    describe('Process Registration', () => {
      test('should register timeout when not connected', () => {
        const callback = jest.fn();
        const timeout = registerTimeout(callback, 1000, 'Test timeout');
        
        expect(timeout).not.toBeNull();
        
        const state = getPreConnectionRegistryState();
        expect(state.counts.timeouts).toBe(1);
        expect(state.counts.total).toBe(1);
        
        // Clean up
        if (timeout) {
          clearTimeout(timeout);
          unregisterTimeout(timeout);
        }
      });

      test('should register interval when not connected', () => {
        const callback = jest.fn();
        const interval = registerInterval(callback, 1000, 'Test interval');
        
        expect(interval).not.toBeNull();
        
        const state = getPreConnectionRegistryState();
        expect(state.counts.intervals).toBe(1);
        expect(state.counts.total).toBe(1);
        
        // Clean up
        if (interval) {
          clearInterval(interval);
          unregisterInterval(interval);
        }
      });

      test('should register abort controller when not connected', () => {
        const controller = registerAbortController('Test controller');
        
        expect(controller).not.toBeNull();
        expect(controller).toBeInstanceOf(AbortController);
        
        const state = getPreConnectionRegistryState();
        expect(state.counts.abortControllers).toBe(1);
        expect(state.counts.total).toBe(1);
        
        // Clean up
        if (controller) {
          controller.abort();
          unregisterAbortController(controller);
        }
      });

      test('should register network probe when not connected', () => {
        const probe = Promise.resolve('test result');
        const registeredProbe = registerNetworkProbe(probe, 'Test probe');
        
        expect(registeredProbe).toBe(probe);
        
        const state = getPreConnectionRegistryState();
        expect(state.counts.networkProbes).toBe(1);
        expect(state.counts.total).toBe(1);
      });
    });

    describe('Process Blocking When Connected', () => {
      beforeEach(() => {
        WebRTCManager.setCallIsConnected(true);
      });

      test('should block timeout registration when connected', () => {
        const callback = jest.fn();
        const timeout = registerTimeout(callback, 1000, 'Blocked timeout');
        
        expect(timeout).toBeNull();
        
        const state = getPreConnectionRegistryState();
        expect(state.counts.timeouts).toBe(0);
        expect(state.counts.total).toBe(0);
      });

      test('should block interval registration when connected', () => {
        const callback = jest.fn();
        const interval = registerInterval(callback, 1000, 'Blocked interval');
        
        expect(interval).toBeNull();
        
        const state = getPreConnectionRegistryState();
        expect(state.counts.intervals).toBe(0);
        expect(state.counts.total).toBe(0);
      });

      test('should block abort controller registration when connected', () => {
        const controller = registerAbortController('Blocked controller');
        
        expect(controller).toBeNull();
        
        const state = getPreConnectionRegistryState();
        expect(state.counts.abortControllers).toBe(0);
        expect(state.counts.total).toBe(0);
      });

      test('should block network probe registration when connected', () => {
        const probe = Promise.resolve('test result');
        const registeredProbe = registerNetworkProbe(probe, 'Blocked probe');
        
        expect(registeredProbe).toBeNull();
        
        const state = getPreConnectionRegistryState();
        expect(state.counts.networkProbes).toBe(0);
        expect(state.counts.total).toBe(0);
      });
    });

    describe('Process Unregistration', () => {
      test('should unregister timeout correctly', () => {
        const callback = jest.fn();
        const timeout = registerTimeout(callback, 1000, 'Test timeout');
        
        expect(timeout).not.toBeNull();
        
        let state = getPreConnectionRegistryState();
        expect(state.counts.timeouts).toBe(1);
        
        if (timeout) {
          clearTimeout(timeout);
          unregisterTimeout(timeout);
        }
        
        state = getPreConnectionRegistryState();
        expect(state.counts.timeouts).toBe(0);
        expect(state.counts.total).toBe(0);
      });

      test('should unregister interval correctly', () => {
        const callback = jest.fn();
        const interval = registerInterval(callback, 1000, 'Test interval');
        
        expect(interval).not.toBeNull();
        
        let state = getPreConnectionRegistryState();
        expect(state.counts.intervals).toBe(1);
        
        if (interval) {
          clearInterval(interval);
          unregisterInterval(interval);
        }
        
        state = getPreConnectionRegistryState();
        expect(state.counts.intervals).toBe(0);
        expect(state.counts.total).toBe(0);
      });

      test('should unregister abort controller correctly', () => {
        const controller = registerAbortController('Test controller');
        
        expect(controller).not.toBeNull();
        
        let state = getPreConnectionRegistryState();
        expect(state.counts.abortControllers).toBe(1);
        
        if (controller) {
          controller.abort();
          unregisterAbortController(controller);
        }
        
        state = getPreConnectionRegistryState();
        expect(state.counts.abortControllers).toBe(0);
        expect(state.counts.total).toBe(0);
      });
    });

    describe('Registry State Management', () => {
      test('should track multiple processes correctly', () => {
        const callback = jest.fn();
        const timeout = registerTimeout(callback, 1000, 'Test timeout');
        const interval = registerInterval(callback, 1000, 'Test interval');
        const controller = registerAbortController('Test controller');
        const probe = registerNetworkProbe(Promise.resolve('test'), 'Test probe');
        
        const state = getPreConnectionRegistryState();
        expect(state.counts.timeouts).toBe(1);
        expect(state.counts.intervals).toBe(1);
        expect(state.counts.abortControllers).toBe(1);
        expect(state.counts.networkProbes).toBe(1);
        expect(state.counts.total).toBe(4);
        
        // Clean up
        if (timeout) {
          clearTimeout(timeout);
          unregisterTimeout(timeout);
        }
        if (interval) {
          clearInterval(interval);
          unregisterInterval(interval);
        }
        if (controller) {
          controller.abort();
          unregisterAbortController(controller);
        }
      });

      test('should reset registry correctly', () => {
        const callback = jest.fn();
        registerTimeout(callback, 1000, 'Test timeout');
        registerInterval(callback, 1000, 'Test interval');
        registerAbortController('Test controller');
        registerNetworkProbe(Promise.resolve('test'), 'Test probe');
        
        let state = getPreConnectionRegistryState();
        expect(state.counts.total).toBe(4);
        
        resetPreConnectionRegistry();
        
        state = getPreConnectionRegistryState();
        expect(state.counts.total).toBe(0);
        expect(state.counts.timeouts).toBe(0);
        expect(state.counts.intervals).toBe(0);
        expect(state.counts.abortControllers).toBe(0);
        expect(state.counts.networkProbes).toBe(0);
      });
    });
  });

  describe('killAllPreConnectionLogic() Function', () => {
    beforeEach(() => {
      // Reset registry and connection state before each test
      resetPreConnectionRegistry();
      WebRTCManager.setCallIsConnected(false);
    });

    test('should clear all registered timeouts', () => {
      const callback = jest.fn();
      const timeout1 = registerTimeout(callback, 1000, 'Test timeout 1');
      const timeout2 = registerTimeout(callback, 2000, 'Test timeout 2');
      
      expect(timeout1).not.toBeNull();
      expect(timeout2).not.toBeNull();
      
      let state = getPreConnectionRegistryState();
      expect(state.counts.timeouts).toBe(2);
      
      // Execute killAllPreConnectionLogic
      killAllPreConnectionLogic();
      
      // Verify all timeouts are cleared
      state = getPreConnectionRegistryState();
      expect(state.counts.timeouts).toBe(0);
      expect(state.detailed.isKilled).toBe(true);
      expect(state.detailed.killedAt).toBeDefined();
    });

    test('should clear all registered intervals', () => {
      const callback = jest.fn();
      const interval1 = registerInterval(callback, 1000, 'Test interval 1');
      const interval2 = registerInterval(callback, 2000, 'Test interval 2');
      
      expect(interval1).not.toBeNull();
      expect(interval2).not.toBeNull();
      
      let state = getPreConnectionRegistryState();
      expect(state.counts.intervals).toBe(2);
      
      // Execute killAllPreConnectionLogic
      killAllPreConnectionLogic();
      
      // Verify all intervals are cleared
      state = getPreConnectionRegistryState();
      expect(state.counts.intervals).toBe(0);
      expect(state.detailed.isKilled).toBe(true);
    });

    test('should abort all registered abort controllers', () => {
      const controller1 = registerAbortController('Test controller 1');
      const controller2 = registerAbortController('Test controller 2');
      
      expect(controller1).not.toBeNull();
      expect(controller2).not.toBeNull();
      expect(controller1?.signal.aborted).toBe(false);
      expect(controller2?.signal.aborted).toBe(false);
      
      let state = getPreConnectionRegistryState();
      expect(state.counts.abortControllers).toBe(2);
      
      // Execute killAllPreConnectionLogic
      killAllPreConnectionLogic();
      
      // Verify all controllers are aborted and cleared
      expect(controller1?.signal.aborted).toBe(true);
      expect(controller2?.signal.aborted).toBe(true);
      
      state = getPreConnectionRegistryState();
      expect(state.counts.abortControllers).toBe(0);
      expect(state.detailed.isKilled).toBe(true);
    });

    test('should clear all registered network probes', () => {
      const probe1 = Promise.resolve('result 1');
      const probe2 = Promise.resolve('result 2');
      
      registerNetworkProbe(probe1, 'Test probe 1');
      registerNetworkProbe(probe2, 'Test probe 2');
      
      let state = getPreConnectionRegistryState();
      expect(state.counts.networkProbes).toBe(2);
      
      // Execute killAllPreConnectionLogic
      killAllPreConnectionLogic();
      
      // Verify all probes are cleared
      state = getPreConnectionRegistryState();
      expect(state.counts.networkProbes).toBe(0);
      expect(state.detailed.isKilled).toBe(true);
    });

    test('should clear all types of processes in one call', () => {
      const callback = jest.fn();
      
      // Register various types of processes
      const timeout = registerTimeout(callback, 1000, 'Test timeout');
      const interval = registerInterval(callback, 1000, 'Test interval');
      const controller = registerAbortController('Test controller');
      const probe = Promise.resolve('test result');
      registerNetworkProbe(probe, 'Test probe');
      
      let state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(4);
      expect(state.counts.timeouts).toBe(1);
      expect(state.counts.intervals).toBe(1);
      expect(state.counts.abortControllers).toBe(1);
      expect(state.counts.networkProbes).toBe(1);
      
      // Execute killAllPreConnectionLogic
      killAllPreConnectionLogic();
      
      // Verify all processes are cleared
      state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(0);
      expect(state.counts.timeouts).toBe(0);
      expect(state.counts.intervals).toBe(0);
      expect(state.counts.abortControllers).toBe(0);
      expect(state.counts.networkProbes).toBe(0);
      expect(state.detailed.isKilled).toBe(true);
      expect(state.detailed.killedAt).toBeDefined();
      
      // Verify abort controller was actually aborted
      expect(controller?.signal.aborted).toBe(true);
    });

    test('should mark registry as killed and prevent new registrations', () => {
      const callback = jest.fn();
      
      // Register some processes
      registerTimeout(callback, 1000, 'Test timeout');
      registerInterval(callback, 1000, 'Test interval');
      
      let state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(2);
      expect(state.detailed.isKilled).toBe(false);
      
      // Execute killAllPreConnectionLogic
      killAllPreConnectionLogic();
      
      // Verify registry is marked as killed
      expect(isPreConnectionLogicKilled()).toBe(true);
      expect(getPreConnectionLogicKilledAt()).toBeDefined();
      
      // Try to register new processes - should be blocked
      const newTimeout = registerTimeout(callback, 1000, 'Blocked timeout');
      const newInterval = registerInterval(callback, 1000, 'Blocked interval');
      const newController = registerAbortController('Blocked controller');
      const newProbe = registerNetworkProbe(Promise.resolve('blocked'), 'Blocked probe');
      
      expect(newTimeout).toBeNull();
      expect(newInterval).toBeNull();
      expect(newController).toBeNull();
      expect(newProbe).toBeNull();
      
      state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(0);
    });

    test('should handle empty registry gracefully', () => {
      // Ensure registry is empty
      let state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(0);
      
      // Execute killAllPreConnectionLogic on empty registry
      expect(() => killAllPreConnectionLogic()).not.toThrow();
      
      // Verify registry is still marked as killed
      state = getPreConnectionRegistryState();
      expect(state.detailed.isKilled).toBe(true);
      expect(state.detailed.killedAt).toBeDefined();
    });

    test('should log cleanup operation details', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const callback = jest.fn();
      
      // Register some processes
      registerTimeout(callback, 1000, 'Test timeout');
      registerInterval(callback, 1000, 'Test interval');
      registerAbortController('Test controller');
      
      // Execute killAllPreConnectionLogic
      killAllPreConnectionLogic();
      
      // Verify logging occurred
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('🔒 killAllPreConnectionLogic() executing')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ killAllPreConnectionLogic() completed successfully')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('📊 Cleanup summary:')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('🔒 All pre-connection logic terminated')
      );
      
      consoleSpy.mockRestore();
    });

    test('should handle cleanup errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const callback = jest.fn();
      
      // Register a timeout
      const timeout = registerTimeout(callback, 1000, 'Test timeout');
      
      // Mock clearTimeout to throw an error
      const originalClearTimeout = global.clearTimeout;
      global.clearTimeout = jest.fn(() => {
        throw new Error('Mock clearTimeout error');
      });
      
      try {
        // Execute killAllPreConnectionLogic - should handle error gracefully
        killAllPreConnectionLogic();
        
        // Verify error was logged but execution continued
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('⚠️ killAllPreConnectionLogic() completed with')
        );
        
        // Verify registry is still marked as killed despite errors
        const state = getPreConnectionRegistryState();
        expect(state.detailed.isKilled).toBe(true);
        
      } finally {
        // Restore original clearTimeout
        global.clearTimeout = originalClearTimeout;
        consoleSpy.mockRestore();
      }
    });
  });

  describe('Connection State Integration with killAllPreConnectionLogic', () => {
    let mockPeerConnection: MockRTCPeerConnection;

    beforeEach(() => {
      resetPreConnectionRegistry();
      WebRTCManager.setCallIsConnected(false);
      mockPeerConnection = new MockRTCPeerConnection();
    });

    test('should automatically call killAllPreConnectionLogic when connection is established', () => {
      const callback = jest.fn();
      
      // Register some pre-connection processes
      registerTimeout(callback, 1000, 'Test timeout');
      registerInterval(callback, 1000, 'Test interval');
      registerAbortController('Test controller');
      
      let state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(3);
      expect(state.detailed.isKilled).toBe(false);
      
      // Setup monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      
      // Simulate connection established
      mockPeerConnection.simulateStateChange('connected');
      
      // Verify CALL_IS_CONNECTED is set and processes are killed
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(0);
      expect(state.detailed.isKilled).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);
    });

    test('should reset registry when connection fails and allow new registrations', () => {
      const callback = jest.fn();
      
      // Establish connection and kill processes
      WebRTCManager.monitorConnectionState(mockPeerConnection as any);
      mockPeerConnection.simulateStateChange('connected');
      
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      expect(isPreConnectionLogicKilled()).toBe(true);
      
      // Simulate connection failure
      mockPeerConnection.simulateStateChange('failed');
      
      // Verify connection state is reset and registry allows new registrations
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
      expect(isPreConnectionLogicKilled()).toBe(false);
      
      // Should be able to register new processes for recovery
      const newTimeout = registerTimeout(callback, 1000, 'Recovery timeout');
      expect(newTimeout).not.toBeNull();
      
      const state = getPreConnectionRegistryState();
      expect(state.counts.total).toBe(1);
    });
  });

  describe('Failure State Recovery Logic', () => {
    beforeEach(() => {
      resetPreConnectionRegistry();
      WebRTCManager.setCallIsConnected(false);
    });

    describe('isActualWebRTCFailure', () => {
      test('should identify connectionState "failed" as actual failure', () => {
        expect(isActualWebRTCFailure('failed', 'new')).toBe(true);
        expect(isActualWebRTCFailure('failed', 'connected')).toBe(true);
        expect(isActualWebRTCFailure('failed', 'disconnected')).toBe(true);
      });

      test('should identify connectionState "closed" as actual failure', () => {
        expect(isActualWebRTCFailure('closed', 'new')).toBe(true);
        expect(isActualWebRTCFailure('closed', 'connected')).toBe(true);
        expect(isActualWebRTCFailure('closed', 'disconnected')).toBe(true);
      });

      test('should identify iceConnectionState "failed" as actual failure', () => {
        expect(isActualWebRTCFailure('new', 'failed')).toBe(true);
        expect(isActualWebRTCFailure('connected', 'failed')).toBe(true);
        expect(isActualWebRTCFailure('disconnected', 'failed')).toBe(true);
      });

      test('should not identify temporary states as actual failures', () => {
        expect(isActualWebRTCFailure('new', 'new')).toBe(false);
        expect(isActualWebRTCFailure('connecting', 'connecting')).toBe(false);
        expect(isActualWebRTCFailure('connected', 'connected')).toBe(false);
        expect(isActualWebRTCFailure('disconnected', 'disconnected')).toBe(false);
      });
    });

    describe('isTemporaryDisconnection', () => {
      test('should identify connectionState "disconnected" without ICE failure as temporary', () => {
        expect(isTemporaryDisconnection('disconnected', 'new')).toBe(true);
        expect(isTemporaryDisconnection('disconnected', 'connecting')).toBe(true);
        expect(isTemporaryDisconnection('disconnected', 'connected')).toBe(true);
        expect(isTemporaryDisconnection('disconnected', 'disconnected')).toBe(true);
      });

      test('should identify iceConnectionState "disconnected" without connection failure as temporary', () => {
        expect(isTemporaryDisconnection('new', 'disconnected')).toBe(true);
        expect(isTemporaryDisconnection('connecting', 'disconnected')).toBe(true);
        expect(isTemporaryDisconnection('connected', 'disconnected')).toBe(true);
      });

      test('should not identify actual failures as temporary disconnections', () => {
        expect(isTemporaryDisconnection('failed', 'disconnected')).toBe(false);
        expect(isTemporaryDisconnection('closed', 'disconnected')).toBe(false);
        expect(isTemporaryDisconnection('disconnected', 'failed')).toBe(false);
      });

      test('should not identify stable states as temporary disconnections', () => {
        expect(isTemporaryDisconnection('new', 'new')).toBe(false);
        expect(isTemporaryDisconnection('connecting', 'connecting')).toBe(false);
        expect(isTemporaryDisconnection('connected', 'connected')).toBe(false);
      });
    });

    describe('shouldAllowRecovery', () => {
      test('should allow recovery for actual WebRTC failures', () => {
        expect(shouldAllowRecovery('failed', 'new')).toBe(true);
        expect(shouldAllowRecovery('closed', 'connected')).toBe(true);
        expect(shouldAllowRecovery('connected', 'failed')).toBe(true);
      });

      test('should not allow recovery for temporary disconnections', () => {
        expect(shouldAllowRecovery('disconnected', 'new')).toBe(false);
        expect(shouldAllowRecovery('connected', 'disconnected')).toBe(false);
        expect(shouldAllowRecovery('disconnected', 'disconnected')).toBe(false);
      });

      test('should not allow recovery when CALL_IS_CONNECTED is true for non-failure states', () => {
        WebRTCManager.setCallIsConnected(true);
        
        expect(shouldAllowRecovery('new', 'new')).toBe(false);
        expect(shouldAllowRecovery('connecting', 'connecting')).toBe(false);
        expect(shouldAllowRecovery('connected', 'connected')).toBe(false);
      });

      test('should allow recovery for actual failures even when CALL_IS_CONNECTED is true', () => {
        WebRTCManager.setCallIsConnected(true);
        
        expect(shouldAllowRecovery('failed', 'new')).toBe(true);
        expect(shouldAllowRecovery('closed', 'connected')).toBe(true);
        expect(shouldAllowRecovery('connected', 'failed')).toBe(true);
      });
    });

    describe('resetConnectionStateForRecovery', () => {
      test('should reset connection state when CALL_IS_CONNECTED is true', () => {
        WebRTCManager.setCallIsConnected(true);
        
        const result = resetConnectionStateForRecovery('Test failure');
        
        expect(result).toBe(true);
        expect(WebRTCManager.getCallIsConnected()).toBe(false);
        expect(isPreConnectionLogicKilled()).toBe(false);
      });

      test('should handle already reset state gracefully', () => {
        WebRTCManager.setCallIsConnected(false);
        
        const result = resetConnectionStateForRecovery('Already reset');
        
        expect(result).toBe(true);
        expect(WebRTCManager.getCallIsConnected()).toBe(false);
      });

      test('should reset process registry along with connection state', () => {
        const callback = jest.fn();
        
        // Set up connected state with killed processes
        WebRTCManager.setCallIsConnected(true);
        killAllPreConnectionLogic();
        
        expect(isPreConnectionLogicKilled()).toBe(true);
        
        // Reset for recovery
        const result = resetConnectionStateForRecovery('Recovery test');
        
        expect(result).toBe(true);
        expect(WebRTCManager.getCallIsConnected()).toBe(false);
        expect(isPreConnectionLogicKilled()).toBe(false);
        
        // Should be able to register new processes
        const timeout = registerTimeout(callback, 1000, 'Recovery timeout');
        expect(timeout).not.toBeNull();
      });
    });

    describe('canStartNewConnection', () => {
      test('should allow new connection when not connected', () => {
        WebRTCManager.setCallIsConnected(false);
        expect(canStartNewConnection()).toBe(true);
      });

      test('should not allow new connection when CALL_IS_CONNECTED is true', () => {
        WebRTCManager.setCallIsConnected(true);
        expect(canStartNewConnection()).toBe(false);
      });

      test('should allow new connection after recovery reset', () => {
        // Simulate connected state
        WebRTCManager.setCallIsConnected(true);
        expect(canStartNewConnection()).toBe(false);
        
        // Reset for recovery
        resetConnectionStateForRecovery('Test recovery');
        expect(canStartNewConnection()).toBe(true);
      });
    });

    describe('getConnectionStateInfo', () => {
      test('should provide comprehensive connection state information', () => {
        const callback = jest.fn();
        
        // Register some processes
        registerTimeout(callback, 1000, 'Test timeout');
        registerInterval(callback, 1000, 'Test interval');
        
        const info = getConnectionStateInfo();
        
        expect(info).toHaveProperty('callIsConnected');
        expect(info).toHaveProperty('processRegistryKilled');
        expect(info).toHaveProperty('canStartNewConnection');
        expect(info).toHaveProperty('activeProcesses');
        
        expect(info.callIsConnected).toBe(false);
        expect(info.processRegistryKilled).toBe(false);
        expect(info.canStartNewConnection).toBe(true);
        expect(info.activeProcesses.total).toBe(2);
        expect(info.activeProcesses.timeouts).toBe(1);
        expect(info.activeProcesses.intervals).toBe(1);
      });

      test('should reflect state changes accurately', () => {
        // Initial state
        let info = getConnectionStateInfo();
        expect(info.callIsConnected).toBe(false);
        expect(info.processRegistryKilled).toBe(false);
        
        // Set connected and kill processes
        WebRTCManager.setCallIsConnected(true);
        killAllPreConnectionLogic();
        
        info = getConnectionStateInfo();
        expect(info.callIsConnected).toBe(true);
        expect(info.processRegistryKilled).toBe(true);
        expect(info.processRegistryKilledAt).toBeDefined();
        expect(info.canStartNewConnection).toBe(false);
        expect(info.activeProcesses.total).toBe(0);
        
        // Reset for recovery
        resetConnectionStateForRecovery('Test reset');
        
        info = getConnectionStateInfo();
        expect(info.callIsConnected).toBe(false);
        expect(info.processRegistryKilled).toBe(false);
        expect(info.canStartNewConnection).toBe(true);
      });
    });

    describe('Integration with Connection State Monitoring', () => {
      let mockPeerConnection: MockRTCPeerConnection;

      beforeEach(() => {
        mockPeerConnection = new MockRTCPeerConnection();
      });

      test('should handle actual failure states correctly', () => {
        // Setup monitoring and establish connection
        WebRTCManager.monitorConnectionState(mockPeerConnection as any);
        mockPeerConnection.simulateStateChange('connected');
        
        expect(WebRTCManager.getCallIsConnected()).toBe(true);
        expect(isPreConnectionLogicKilled()).toBe(true);
        
        // Simulate actual failure
        mockPeerConnection.simulateStateChange('failed');
        
        // Should reset for recovery
        expect(WebRTCManager.getCallIsConnected()).toBe(false);
        expect(isPreConnectionLogicKilled()).toBe(false);
        expect(canStartNewConnection()).toBe(true);
      });

      test('should handle closed state correctly', () => {
        // Setup monitoring and establish connection
        WebRTCManager.monitorConnectionState(mockPeerConnection as any);
        mockPeerConnection.simulateStateChange('connected');
        
        expect(WebRTCManager.getCallIsConnected()).toBe(true);
        
        // Simulate connection closed
        mockPeerConnection.simulateStateChange('closed');
        
        // Should reset for recovery
        expect(WebRTCManager.getCallIsConnected()).toBe(false);
        expect(canStartNewConnection()).toBe(true);
      });

      test('should handle ICE connection failure correctly', () => {
        // Setup monitoring and establish connection
        WebRTCManager.monitorConnectionState(mockPeerConnection as any);
        mockPeerConnection.simulateStateChange('connected', 'connected');
        
        expect(WebRTCManager.getCallIsConnected()).toBe(true);
        
        // Simulate ICE failure while connection state remains connected
        mockPeerConnection.simulateStateChange(undefined, 'failed');
        
        // Should reset for recovery due to ICE failure
        expect(WebRTCManager.getCallIsConnected()).toBe(false);
        expect(canStartNewConnection()).toBe(true);
      });

      test('should maintain connection for temporary disconnections', () => {
        // Setup monitoring and establish connection
        WebRTCManager.monitorConnectionState(mockPeerConnection as any);
        mockPeerConnection.simulateStateChange('connected');
        
        expect(WebRTCManager.getCallIsConnected()).toBe(true);
        expect(isPreConnectionLogicKilled()).toBe(true);
        
        // Simulate temporary disconnection
        mockPeerConnection.simulateStateChange('disconnected');
        
        // Should maintain connected state (temporary disconnection)
        expect(WebRTCManager.getCallIsConnected()).toBe(true);
        expect(isPreConnectionLogicKilled()).toBe(true);
        expect(canStartNewConnection()).toBe(false);
      });

      test('should handle rapid state changes correctly', () => {
        // Setup monitoring
        WebRTCManager.monitorConnectionState(mockPeerConnection as any);
        
        // Rapid state changes
        mockPeerConnection.simulateStateChange('connecting');
        expect(WebRTCManager.getCallIsConnected()).toBe(false);
        
        mockPeerConnection.simulateStateChange('connected');
        expect(WebRTCManager.getCallIsConnected()).toBe(true);
        
        mockPeerConnection.simulateStateChange('disconnected');
        expect(WebRTCManager.getCallIsConnected()).toBe(true); // Temporary disconnection
        
        mockPeerConnection.simulateStateChange('failed');
        expect(WebRTCManager.getCallIsConnected()).toBe(false); // Actual failure
        
        mockPeerConnection.simulateStateChange('connected');
        expect(WebRTCManager.getCallIsConnected()).toBe(true); // Reconnected
      });
    });
  });

  // Property-Based Test for Connection State Authority
  describe('Property-Based Tests', () => {
    describe('Property 1: Connection State Authority', () => {
      /**
       * Feature: fix-auto-disconnect, Property 1: Connection State Authority
       * Validates: Requirements 1.1 with failure state override
       * 
       * For any RTCPeerConnection with connectionState === "connected" OR 
       * iceConnectionState === "connected", the CALL_IS_CONNECTED flag 
       * should be set to true immediately, UNLESS there is an actual failure
       * state that overrides the connection (failed/closed states).
       */
      test('should set CALL_IS_CONNECTED to true for any connection state that indicates connected', () => {
        const fc = require('fast-check');
        
        const connectionStates: RTCPeerConnectionState[] = ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'];
        const iceConnectionStates: RTCIceConnectionState[] = ['new', 'checking', 'connected', 'completed', 'failed', 'disconnected', 'closed'];
        
        const connectionStateArb = fc.constantFrom(...connectionStates);
        const iceConnectionStateArb = fc.constantFrom(...iceConnectionStates);
        
        fc.assert(
          fc.property(
            connectionStateArb,
            iceConnectionStateArb,
            (connectionState: RTCPeerConnectionState, iceConnectionState: RTCIceConnectionState) => {
              // Reset state before each test
              resetPreConnectionRegistry();
              WebRTCManager.setCallIsConnected(false);
              
              const mockPeerConnection = new MockRTCPeerConnection();
              mockPeerConnection.connectionState = connectionState;
              mockPeerConnection.iceConnectionState = iceConnectionState;
              
              // Setup monitoring
              WebRTCManager.monitorConnectionState(mockPeerConnection as any);
              
              // Simulate the state change
              mockPeerConnection.simulateStateChange(connectionState, iceConnectionState);
              
              // Property: CALL_IS_CONNECTED should be true when either state is "connected"
              // AND there are no actual failure states that override the connection
              const hasConnection = connectionState === 'connected' || iceConnectionState === 'connected';
              const hasActualFailure = connectionState === 'failed' || connectionState === 'closed' || iceConnectionState === 'failed';
              
              // If there's an actual failure, connection should be false regardless of connected states
              // If there's no failure and there's a connection, it should be true
              const shouldBeConnected = hasConnection && !hasActualFailure;
              const actuallyConnected = WebRTCManager.getCallIsConnected();
              
              return shouldBeConnected === actuallyConnected;
            }
          ),
          { numRuns: 100 }
        );
      });
    });
  });
});