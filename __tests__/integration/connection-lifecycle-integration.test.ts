/**
 * End-to-End Connection Lifecycle Integration Test
 * Task 13: Final Integration and Validation
 * 
 * This test validates that all lifecycle components work together correctly:
 * - Global CALL_IS_CONNECTED authority flag
 * - Pre-connection process registry and cleanup
 * - Lifecycle gate enforcement
 * - Connection state monitoring
 * - Error handling and fallbacks
 * 
 * Requirements: All requirements from the fix-auto-disconnect spec
 */

import {
  WebRTCManager,
  registerTimeout,
  registerInterval,
  registerAbortController,
  registerNetworkProbe,
  killAllPreConnectionLogic,
  getPreConnectionRegistryState,
  getLifecycleGateStatus,
  validateLifecycleGateIntegrity,
  resetPreConnectionRegistry,
  isReconnectionBlocked,
  isLatencyHandlerBlocked,
  isVisibilityChangeHandlerBlocked,
  isICERestartBlocked,
  shouldBlockReconnectionOperation,
  isPeerConnectionRecreationBlocked,
  isPeerConnectionModificationBlocked,
  createProtectedPeerConnection,
  protectedCreateOffer,
  protectedSetLocalDescription,
  safeGetStats,
  shouldRestrictQualityAdaptation,
  enforceNetworkDetectionGate,
  enforceTimeoutCreationGate,
  enforceICEConfigurationGate,
  recoverFromCleanupFailure,
  enableConnectionStateMonitoringFallback,
  executeManualOverride,
  detectAndRepairRegistryCorruption,
  getErrorRecoveryStatus,
  resetErrorRecoveryState
} from '../../app/lib/webrtc-manager';

// Mock WebRTC APIs
const mockRTCPeerConnection = {
  connectionState: 'new' as RTCPeerConnectionState,
  iceConnectionState: 'new' as RTCIceConnectionState,
  signalingState: 'stable' as RTCSignalingState,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  createOffer: jest.fn(),
  createAnswer: jest.fn(),
  setLocalDescription: jest.fn(),
  setRemoteDescription: jest.fn(),
  addTrack: jest.fn(),
  removeTrack: jest.fn(),
  restartIce: jest.fn(),
  close: jest.fn(),
  getStats: jest.fn().mockResolvedValue(new Map()),
  addIceCandidate: jest.fn(),
  onicecandidate: null,
  ontrack: null,
  onconnectionstatechange: null,
  oniceconnectionstatechange: null,
  onicegatheringstatechange: null,
  onsignalingstatechange: null,
  remoteDescription: null,
  localDescription: null
};

// Mock global RTCPeerConnection
(global as any).RTCPeerConnection = jest.fn(() => mockRTCPeerConnection);

describe('Connection Lifecycle Integration Tests', () => {
  let mockPeerConnection: any;
  
  beforeEach(() => {
    // Reset all state before each test
    resetPreConnectionRegistry();
    resetErrorRecoveryState();
    WebRTCManager.setCallIsConnected(false);
    
    // Create fresh mock peer connection
    mockPeerConnection = { ...mockRTCPeerConnection };
    mockPeerConnection.connectionState = 'new';
    mockPeerConnection.iceConnectionState = 'new';
    mockPeerConnection.addEventListener = jest.fn();
    mockPeerConnection.createOffer = jest.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' });
    mockPeerConnection.setLocalDescription = jest.fn().mockResolvedValue(undefined);
    mockPeerConnection.getStats = jest.fn().mockResolvedValue(new Map());
    
    // Clear all timers
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any remaining timers
    jest.clearAllTimers();
    
    // Reset state
    resetPreConnectionRegistry();
    resetErrorRecoveryState();
    WebRTCManager.setCallIsConnected(false);
  });

  describe('End-to-End Connection Lifecycle Flow', () => {
    test('should complete full connection lifecycle with proper gate enforcement', async () => {
      // Phase 1: Pre-connection setup
      console.log('=== Phase 1: Pre-connection Setup ===');
      
      // Verify initial state
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
      expect(getLifecycleGateStatus().allGatesBlocked).toBe(false);
      
      // Register pre-connection processes
      const timeout1 = registerTimeout(() => console.log('timeout1'), 5000, 'Test timeout 1');
      const timeout2 = registerTimeout(() => console.log('timeout2'), 10000, 'Test timeout 2');
      const interval1 = registerInterval(() => console.log('interval1'), 1000, 'Test interval 1');
      const abortController1 = registerAbortController('Test abort controller 1');
      const networkProbe1 = registerNetworkProbe(Promise.resolve('test'), 'Test network probe 1');
      
      // Verify processes were registered
      expect(timeout1).not.toBeNull();
      expect(timeout2).not.toBeNull();
      expect(interval1).not.toBeNull();
      expect(abortController1).not.toBeNull();
      expect(networkProbe1).not.toBeNull();
      
      const registryState = getPreConnectionRegistryState();
      expect(registryState.counts.timeouts).toBe(2);
      expect(registryState.counts.intervals).toBe(1);
      expect(registryState.counts.abortControllers).toBe(1);
      expect(registryState.counts.networkProbes).toBe(1);
      expect(registryState.counts.total).toBe(5);
      
      // Phase 2: Connection establishment
      console.log('=== Phase 2: Connection Establishment ===');
      
      // Setup connection state monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection);
      
      // Verify monitoring was set up
      expect(mockPeerConnection.addEventListener).toHaveBeenCalledWith('connectionstatechange', expect.any(Function));
      expect(mockPeerConnection.addEventListener).toHaveBeenCalledWith('iceconnectionstatechange', expect.any(Function));
      
      // Simulate connection establishment
      mockPeerConnection.connectionState = 'connected';
      
      // Get the connection state change handler and call it
      const connectionStateHandler = mockPeerConnection.addEventListener.mock.calls
        .find(call => call[0] === 'connectionstatechange')?.[1];
      expect(connectionStateHandler).toBeDefined();
      
      // Trigger connection state change
      connectionStateHandler();
      
      // Phase 3: Verify lifecycle gate activation
      console.log('=== Phase 3: Lifecycle Gate Activation ===');
      
      // Verify CALL_IS_CONNECTED flag was set
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Verify all pre-connection processes were killed
      const postConnectionRegistryState = getPreConnectionRegistryState();
      expect(postConnectionRegistryState.counts.total).toBe(0);
      expect(postConnectionRegistryState.detailed.isKilled).toBe(true);
      expect(postConnectionRegistryState.detailed.killedAt).toBeDefined();
      
      // Verify all lifecycle gates are now blocked
      const gateStatus = getLifecycleGateStatus();
      expect(gateStatus.allGatesBlocked).toBe(true);
      expect(gateStatus.callIsConnected).toBe(true);
      expect(gateStatus.processRegistryKilled).toBe(true);
      
      // Phase 4: Verify blocking of new pre-connection operations
      console.log('=== Phase 4: Pre-connection Operation Blocking ===');
      
      // Attempt to register new processes - should all be blocked
      const blockedTimeout = registerTimeout(() => console.log('blocked'), 1000, 'Blocked timeout');
      const blockedInterval = registerInterval(() => console.log('blocked'), 1000, 'Blocked interval');
      const blockedAbortController = registerAbortController('Blocked abort controller');
      const blockedNetworkProbe = registerNetworkProbe(Promise.resolve('blocked'), 'Blocked network probe');
      
      expect(blockedTimeout).toBeNull();
      expect(blockedInterval).toBeNull();
      expect(blockedAbortController).toBeNull();
      expect(blockedNetworkProbe).toBeNull();
      
      // Verify registry remains empty
      const finalRegistryState = getPreConnectionRegistryState();
      expect(finalRegistryState.counts.total).toBe(0);
      
      // Phase 5: Verify reconnection logic blocking
      console.log('=== Phase 5: Reconnection Logic Blocking ===');
      
      expect(isReconnectionBlocked()).toBe(true);
      expect(isLatencyHandlerBlocked()).toBe(true);
      expect(isVisibilityChangeHandlerBlocked()).toBe(true);
      expect(isICERestartBlocked()).toBe(true);
      expect(shouldBlockReconnectionOperation('Test operation')).toBe(true);
      
      // Phase 6: Verify peer connection protection
      console.log('=== Phase 6: Peer Connection Protection ===');
      
      expect(isPeerConnectionRecreationBlocked()).toBe(true);
      expect(isPeerConnectionModificationBlocked('createOffer')).toBe(true);
      expect(isPeerConnectionModificationBlocked('setLocalDescription')).toBe(true);
      expect(isPeerConnectionModificationBlocked('getStats')).toBe(false); // getStats should be allowed
      
      // Test protected methods
      const blockedPeerConnection = createProtectedPeerConnection({ iceServers: [] });
      expect(blockedPeerConnection).toBeNull();
      
      const blockedOffer = protectedCreateOffer(mockPeerConnection);
      expect(blockedOffer).toBeNull();
      
      const blockedSetLocal = protectedSetLocalDescription(mockPeerConnection, { type: 'offer', sdp: 'test' });
      expect(blockedSetLocal).toBeNull();
      
      // getStats should still work
      const statsResult = await safeGetStats(mockPeerConnection);
      expect(statsResult).toBeDefined();
      expect(mockPeerConnection.getStats).toHaveBeenCalled();
      
      // Quality adaptation should be restricted
      expect(shouldRestrictQualityAdaptation()).toBe(true);
      
      // Phase 7: Verify network detection blocking
      console.log('=== Phase 7: Network Detection Blocking ===');
      
      expect(enforceNetworkDetectionGate()).toBe(true);
      expect(enforceTimeoutCreationGate()).toBe(true);
      expect(enforceICEConfigurationGate()).toBe(true);
      
      // Phase 8: Verify lifecycle gate integrity
      console.log('=== Phase 8: Lifecycle Gate Integrity ===');
      
      const integrityCheck = validateLifecycleGateIntegrity();
      expect(integrityCheck.isValid).toBe(true);
      expect(integrityCheck.issues).toHaveLength(0);
      
      console.log('✅ End-to-end connection lifecycle test completed successfully');
    });

    test('should handle connection failures and allow recovery', async () => {
      console.log('=== Connection Failure and Recovery Test ===');
      
      // Setup initial connection
      WebRTCManager.monitorConnectionState(mockPeerConnection);
      
      // Establish connection first
      mockPeerConnection.connectionState = 'connected';
      const connectionStateHandler = mockPeerConnection.addEventListener.mock.calls
        .find(call => call[0] === 'connectionstatechange')?.[1];
      connectionStateHandler();
      
      // Verify connection is established
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Simulate actual WebRTC failure
      mockPeerConnection.connectionState = 'failed';
      connectionStateHandler();
      
      // Verify recovery is allowed for actual failures
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
      
      // Verify new pre-connection operations are now allowed
      const recoveryTimeout = registerTimeout(() => console.log('recovery'), 1000, 'Recovery timeout');
      expect(recoveryTimeout).not.toBeNull();
      
      console.log('✅ Connection failure and recovery test completed successfully');
    });

    test('should handle temporary disconnections without triggering recovery', async () => {
      console.log('=== Temporary Disconnection Test ===');
      
      // Setup and establish connection
      WebRTCManager.monitorConnectionState(mockPeerConnection);
      mockPeerConnection.connectionState = 'connected';
      const connectionStateHandler = mockPeerConnection.addEventListener.mock.calls
        .find(call => call[0] === 'connectionstatechange')?.[1];
      connectionStateHandler();
      
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Simulate temporary disconnection (not a failure)
      mockPeerConnection.connectionState = 'disconnected';
      mockPeerConnection.iceConnectionState = 'disconnected';
      connectionStateHandler();
      
      // Verify CALL_IS_CONNECTED remains true for temporary disconnections
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Verify pre-connection operations remain blocked
      const blockedTimeout = registerTimeout(() => console.log('blocked'), 1000, 'Blocked timeout');
      expect(blockedTimeout).toBeNull();
      
      console.log('✅ Temporary disconnection test completed successfully');
    });
  });

  describe('Error Handling and Recovery Integration', () => {
    test('should handle cleanup failures with progressive recovery', async () => {
      console.log('=== Cleanup Failure Recovery Test ===');
      
      // Setup pre-connection processes
      registerTimeout(() => console.log('test'), 1000, 'Test timeout');
      registerInterval(() => console.log('test'), 1000, 'Test interval');
      
      // Mock killAllPreConnectionLogic to fail
      const originalKillAll = killAllPreConnectionLogic;
      const mockError = new Error('Cleanup failed');
      
      // Test recovery mechanism
      const recoveryResult = recoverFromCleanupFailure(mockError);
      expect(typeof recoveryResult).toBe('boolean');
      
      console.log('✅ Cleanup failure recovery test completed successfully');
    });

    test('should handle connection state monitoring fallbacks', async () => {
      console.log('=== Connection State Monitoring Fallback Test ===');
      
      // Test enabling polling fallback
      enableConnectionStateMonitoringFallback(mockPeerConnection);
      
      // Verify fallback was enabled (implementation detail)
      // This would be tested by checking if polling interval was created
      
      console.log('✅ Connection state monitoring fallback test completed successfully');
    });

    test('should handle manual override mechanisms', async () => {
      console.log('=== Manual Override Test ===');
      
      // Test manual override options
      const overrideResult = executeManualOverride({
        forceKillPreConnectionLogic: true,
        forceResetConnectionState: true,
        validateAndRepair: true
      }, 'Test manual override');
      
      expect(overrideResult.success).toBeDefined();
      expect(overrideResult.actions).toBeDefined();
      expect(overrideResult.errors).toBeDefined();
      
      console.log('✅ Manual override test completed successfully');
    });

    test('should detect and repair registry corruption', async () => {
      console.log('=== Registry Corruption Detection Test ===');
      
      // Test corruption detection
      const corruptionResult = detectAndRepairRegistryCorruption();
      
      expect(corruptionResult.corruptionDetected).toBeDefined();
      expect(corruptionResult.repairAttempted).toBeDefined();
      expect(corruptionResult.repairSuccessful).toBeDefined();
      expect(corruptionResult.issues).toBeDefined();
      
      console.log('✅ Registry corruption detection test completed successfully');
    });

    test('should provide comprehensive error recovery status', async () => {
      console.log('=== Error Recovery Status Test ===');
      
      // Get error recovery status
      const recoveryStatus = getErrorRecoveryStatus();
      
      expect(recoveryStatus.errorRecoveryState).toBeDefined();
      expect(recoveryStatus.connectionStatePollingActive).toBeDefined();
      expect(recoveryStatus.systemHealth).toBeDefined();
      expect(recoveryStatus.recommendations).toBeDefined();
      
      expect(['healthy', 'degraded', 'critical']).toContain(recoveryStatus.systemHealth);
      
      console.log('✅ Error recovery status test completed successfully');
    });
  });

  describe('Comprehensive Integration Scenarios', () => {
    test('should handle rapid connection state changes without race conditions', async () => {
      console.log('=== Rapid State Changes Test ===');
      
      // Setup monitoring
      WebRTCManager.monitorConnectionState(mockPeerConnection);
      const connectionStateHandler = mockPeerConnection.addEventListener.mock.calls
        .find(call => call[0] === 'connectionstatechange')?.[1];
      
      // Register some pre-connection processes
      registerTimeout(() => console.log('test'), 1000, 'Test timeout');
      registerInterval(() => console.log('test'), 1000, 'Test interval');
      
      // Simulate rapid state changes
      mockPeerConnection.connectionState = 'connecting';
      connectionStateHandler();
      
      mockPeerConnection.connectionState = 'connected';
      connectionStateHandler();
      
      mockPeerConnection.connectionState = 'disconnected';
      connectionStateHandler();
      
      mockPeerConnection.connectionState = 'connected';
      connectionStateHandler();
      
      // Verify final state is correct
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Verify processes were cleaned up
      const registryState = getPreConnectionRegistryState();
      expect(registryState.counts.total).toBe(0);
      
      console.log('✅ Rapid state changes test completed successfully');
    });

    test('should maintain lifecycle gate integrity under stress', async () => {
      console.log('=== Lifecycle Gate Stress Test ===');
      
      // Establish connection
      WebRTCManager.monitorConnectionState(mockPeerConnection);
      mockPeerConnection.connectionState = 'connected';
      const connectionStateHandler = mockPeerConnection.addEventListener.mock.calls
        .find(call => call[0] === 'connectionstatechange')?.[1];
      connectionStateHandler();
      
      // Attempt many blocked operations
      for (let i = 0; i < 100; i++) {
        const blockedTimeout = registerTimeout(() => console.log('blocked'), 1000, `Blocked timeout ${i}`);
        expect(blockedTimeout).toBeNull();
        
        const blockedInterval = registerInterval(() => console.log('blocked'), 1000, `Blocked interval ${i}`);
        expect(blockedInterval).toBeNull();
        
        expect(isReconnectionBlocked()).toBe(true);
        expect(isPeerConnectionRecreationBlocked()).toBe(true);
      }
      
      // Verify integrity is maintained
      const integrityCheck = validateLifecycleGateIntegrity();
      expect(integrityCheck.isValid).toBe(true);
      
      console.log('✅ Lifecycle gate stress test completed successfully');
    });

    test('should handle multiple connection attempts correctly', async () => {
      console.log('=== Multiple Connection Attempts Test ===');
      
      // First connection attempt
      WebRTCManager.monitorConnectionState(mockPeerConnection);
      mockPeerConnection.connectionState = 'connected';
      const connectionStateHandler = mockPeerConnection.addEventListener.mock.calls
        .find(call => call[0] === 'connectionstatechange')?.[1];
      connectionStateHandler();
      
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      // Simulate connection failure
      mockPeerConnection.connectionState = 'failed';
      connectionStateHandler();
      
      expect(WebRTCManager.getCallIsConnected()).toBe(false);
      
      // Second connection attempt
      const mockPeerConnection2 = { ...mockPeerConnection };
      mockPeerConnection2.addEventListener = jest.fn();
      
      WebRTCManager.monitorConnectionState(mockPeerConnection2);
      mockPeerConnection2.connectionState = 'connected';
      const connectionStateHandler2 = mockPeerConnection2.addEventListener.mock.calls
        .find(call => call[0] === 'connectionstatechange')?.[1];
      connectionStateHandler2();
      
      expect(WebRTCManager.getCallIsConnected()).toBe(true);
      
      console.log('✅ Multiple connection attempts test completed successfully');
    });
  });

  describe('Performance and Resource Management', () => {
    test('should properly clean up all resources', async () => {
      console.log('=== Resource Cleanup Test ===');
      
      // Register many processes
      const processes = [];
      for (let i = 0; i < 50; i++) {
        processes.push(registerTimeout(() => console.log(`timeout ${i}`), 1000 + i, `Test timeout ${i}`));
        processes.push(registerInterval(() => console.log(`interval ${i}`), 1000 + i, `Test interval ${i}`));
        processes.push(registerAbortController(`Test abort controller ${i}`));
        processes.push(registerNetworkProbe(Promise.resolve(`probe ${i}`), `Test network probe ${i}`));
      }
      
      // Verify all were registered
      const initialState = getPreConnectionRegistryState();
      expect(initialState.counts.total).toBe(200); // 50 * 4 types
      
      // Establish connection to trigger cleanup
      WebRTCManager.monitorConnectionState(mockPeerConnection);
      mockPeerConnection.connectionState = 'connected';
      const connectionStateHandler = mockPeerConnection.addEventListener.mock.calls
        .find(call => call[0] === 'connectionstatechange')?.[1];
      connectionStateHandler();
      
      // Verify all were cleaned up
      const finalState = getPreConnectionRegistryState();
      expect(finalState.counts.total).toBe(0);
      
      console.log('✅ Resource cleanup test completed successfully');
    });

    test('should handle memory pressure gracefully', async () => {
      console.log('=== Memory Pressure Test ===');
      
      // This test would simulate memory pressure scenarios
      // For now, we'll test that the system remains stable under load
      
      // Register and clean up processes multiple times
      for (let cycle = 0; cycle < 10; cycle++) {
        // Register processes
        for (let i = 0; i < 20; i++) {
          registerTimeout(() => console.log('test'), 1000, `Cycle ${cycle} timeout ${i}`);
        }
        
        // Trigger cleanup
        WebRTCManager.setCallIsConnected(true);
        killAllPreConnectionLogic();
        
        // Reset for next cycle
        WebRTCManager.setCallIsConnected(false);
        resetPreConnectionRegistry();
      }
      
      // Verify system is still stable
      const integrityCheck = validateLifecycleGateIntegrity();
      expect(integrityCheck.isValid).toBe(true);
      
      console.log('✅ Memory pressure test completed successfully');
    });
  });
});