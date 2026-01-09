/**
 * Performance Metrics Collector Tests
 * 
 * Tests for the WebRTC performance monitoring and metrics collection system.
 * Validates timing accuracy, alert generation, and network classification.
 * 
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5 - Performance monitoring validation
 */

import {
  PerformanceMetricsCollector,
  performanceMetricsCollector,
  startConnectionTiming,
  recordConnectionMilestone,
  recordICECandidateMetrics,
  completeConnectionTiming,
  getPerformanceStatistics,
  getNetworkAdaptations,
  getPerformanceAlerts,
  type ConnectionMetrics,
  type PerformanceAlert,
  type PerformanceStats
} from './performance-metrics-collector';

// Mock performance.now for consistent testing
const mockPerformanceNow = jest.fn();
Object.defineProperty(global, 'performance', {
  value: { now: mockPerformanceNow },
  writable: true
});

// Mock navigator for network classification tests
const mockNavigator = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  connection: {
    effectiveType: '4g',
    type: 'cellular'
  }
};
Object.defineProperty(global, 'navigator', {
  value: mockNavigator,
  writable: true
});

// Mock window.screen for mobile detection
if (typeof window === 'undefined') {
  Object.defineProperty(global, 'window', {
    value: {
      screen: { width: 1920, height: 1080 }
    },
    writable: true,
    configurable: true
  });
} else {
  Object.defineProperty(window, 'screen', {
    value: { width: 1920, height: 1080 },
    writable: true,
    configurable: true
  });
}

describe('PerformanceMetricsCollector', () => {
  let collector: PerformanceMetricsCollector;
  let mockTime = 1000;

  beforeEach(() => {
    collector = new PerformanceMetricsCollector();
    mockTime = 1000;
    mockPerformanceNow.mockImplementation(() => mockTime);
    
    // Clear any existing metrics
    collector.clearMetrics();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Connection Timing Measurement (Requirement 10.1)', () => {
    test('should start connection timing correctly', () => {
      const sessionId = 'test-session-123';
      const userId = 'user-456';
      const attemptNumber = 1;

      collector.startConnectionTiming(sessionId, userId, attemptNumber);

      // Verify timing started
      expect(mockPerformanceNow).toHaveBeenCalled();
    });

    test('should record milestones with correct timing', () => {
      collector.startConnectionTiming('session-1');
      
      // Advance time and record milestone
      mockTime = 1500;
      collector.recordMilestone('mediaReady');
      
      mockTime = 2000;
      collector.recordMilestone('iceGatheringStart');
      
      mockTime = 2500;
      collector.recordMilestone('firstCandidate');
      
      mockTime = 5000;
      const metrics = collector.completeConnectionTiming(true);
      
      expect(metrics.mediaReadyTime).toBe(1500);
      expect(metrics.iceGatheringStartTime).toBe(2000);
      expect(metrics.firstCandidateTime).toBe(2500);
      expect(metrics.totalConnectionTime).toBe(4000); // 5000 - 1000
      expect(metrics.success).toBe(true);
    });

    test('should handle connection failure correctly', () => {
      collector.startConnectionTiming('session-1');
      
      mockTime = 8000;
      const metrics = collector.completeConnectionTiming(false, 'ICE gathering timeout');
      
      expect(metrics.success).toBe(false);
      expect(metrics.failureReason).toBe('ICE gathering timeout');
      expect(metrics.totalConnectionTime).toBe(7000);
      expect(metrics.exceededTarget).toBe(true); // > 5000ms
    });

    test('should measure connection time consistency', () => {
      const connectionTimes: number[] = [];
      
      // Simulate multiple connections
      for (let i = 0; i < 5; i++) {
        collector.startConnectionTiming(`session-${i}`);
        mockTime += 4000; // 4 second connections
        const metrics = collector.completeConnectionTiming(true);
        connectionTimes.push(metrics.totalConnectionTime!);
      }
      
      // All connections should be under 5 seconds
      connectionTimes.forEach(time => {
        expect(time).toBeLessThan(5000);
        expect(time).toBeGreaterThan(3900); // Around 4 seconds
      });
    });
  });

  describe('ICE Candidate Type Tracking (Requirement 10.2)', () => {
    test('should classify ICE candidates correctly', () => {
      collector.startConnectionTiming('session-1');
      
      // Mock different candidate types
      const hostCandidate = { candidate: 'candidate:1 1 UDP 2113667326 192.168.1.100 54400 typ host' } as RTCIceCandidate;
      const stunCandidate = { candidate: 'candidate:2 1 UDP 1677729535 203.0.113.1 54401 typ srflx raddr 192.168.1.100 rport 54400' } as RTCIceCandidate;
      const turnCandidate = { candidate: 'candidate:3 1 UDP 16777215 203.0.113.2 3478 typ relay raddr 203.0.113.1 rport 54401' } as RTCIceCandidate;
      
      collector.recordICECandidate(hostCandidate);
      collector.recordICECandidate(stunCandidate);
      collector.recordICECandidate(turnCandidate, true); // This one succeeds
      
      const metrics = collector.completeConnectionTiming(true);
      
      expect(metrics.candidateTypes).toContain('host');
      expect(metrics.candidateTypes).toContain('stun-srflx');
      expect(metrics.candidateTypes).toContain('turn-relay');
      expect(metrics.successfulCandidateType).toBe('turn-relay');
    });

    test('should track TURN server usage', () => {
      collector.startConnectionTiming('session-1');
      
      const turnUdpCandidate = { candidate: 'candidate:1 1 UDP 16777215 203.0.113.2 3478 typ relay udp' } as RTCIceCandidate;
      const turnTcpCandidate = { candidate: 'candidate:2 1 TCP 16777214 203.0.113.2 3478 typ relay tcp' } as RTCIceCandidate;
      
      collector.recordICECandidate(turnUdpCandidate);
      collector.recordICECandidate(turnTcpCandidate);
      
      const metrics = collector.completeConnectionTiming(true);
      
      expect(metrics.turnServersUsed).toBe(2);
    });
  });

  describe('Network Type Classification (Requirement 10.3)', () => {
    test('should classify mobile network correctly', () => {
      // Mock mobile network indicators
      mockNavigator.connection.effectiveType = '4g';
      mockNavigator.connection.type = 'cellular';
      mockNavigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)';
      
      const classification = collector.classifyNetwork();
      
      expect(classification.type).toBe('mobile');
      expect(classification.confidence).toBeGreaterThan(0.8);
      expect(classification.adaptations).toContain('Use TURN-first strategy');
    });

    test('should classify WiFi network correctly', () => {
      // Mock WiFi network indicators
      mockNavigator.connection.type = 'wifi';
      mockNavigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
      
      const classification = collector.classifyNetwork();
      
      expect(classification.type).toBe('wifi');
      expect(classification.confidence).toBeGreaterThan(0.8);
      expect(classification.adaptations).toContain('Use parallel STUN/TURN gathering');
    });

    test('should provide network adaptation recommendations', () => {
      const adaptations = collector.getNetworkAdaptationRecommendations();
      
      expect(adaptations.currentNetwork).toBeDefined();
      expect(adaptations.recommendations).toBeInstanceOf(Array);
      expect(adaptations.configurationSuggestions).toHaveProperty('iceTransportPolicy');
      expect(adaptations.configurationSuggestions).toHaveProperty('iceCandidatePoolSize');
      expect(adaptations.configurationSuggestions).toHaveProperty('turnFallbackTimeout');
    });
  });

  describe('Performance Alerts (Requirement 10.4)', () => {
    test('should generate alert for slow connection', () => {
      collector.startConnectionTiming('session-1');
      
      // Simulate slow connection (> 5 seconds)
      mockTime = 7000;
      collector.completeConnectionTiming(true);
      
      const alerts = collector.getRecentAlerts(1);
      expect(alerts.length).toBeGreaterThan(0);
      
      const slowConnectionAlert = alerts.find(a => a.type === 'connection-timeout');
      expect(slowConnectionAlert).toBeDefined();
      expect(slowConnectionAlert?.severity).toBe('warning');
    });

    test('should generate alert for connection failure', () => {
      collector.startConnectionTiming('session-1');
      
      mockTime = 3000;
      collector.completeConnectionTiming(false, 'Network unreachable');
      
      const alerts = collector.getRecentAlerts(1);
      expect(alerts.length).toBeGreaterThan(0);
      
      const failureAlert = alerts.find(a => a.type === 'repeated-failure');
      expect(failureAlert).toBeDefined();
      expect(failureAlert?.severity).toBe('error');
    });

    test('should generate alert for TURN fallback', () => {
      collector.startConnectionTiming('session-1');
      
      mockTime = 3500;
      collector.recordMilestone('turnFallback', { reason: 'STUN timeout' });
      
      mockTime = 5000;
      collector.completeConnectionTiming(true);
      
      const alerts = collector.getRecentAlerts(1);
      const turnAlert = alerts.find(a => a.type === 'turn-fallback');
      expect(turnAlert).toBeDefined();
      expect(turnAlert?.message).toContain('TURN fallback triggered');
    });

    test('should generate critical alert for repeated failures', () => {
      const userId = 'user-123';
      
      // Simulate multiple failures for same user
      for (let i = 0; i < 3; i++) {
        collector.startConnectionTiming(`session-${i}`, userId, i + 1);
        mockTime += 3000;
        collector.completeConnectionTiming(false, 'Connection failed');
      }
      
      const alerts = collector.getRecentAlerts(5);
      const criticalAlert = alerts.find(a => a.severity === 'critical');
      expect(criticalAlert).toBeDefined();
      expect(criticalAlert?.message).toContain('recent connection failures');
    });
  });

  describe('Performance Statistics (Requirement 10.5)', () => {
    test('should calculate performance statistics correctly', () => {
      // Simulate multiple connections with different outcomes
      const connections = [
        { success: true, time: 3000 },
        { success: true, time: 4000 },
        { success: false, time: 8000 },
        { success: true, time: 2000 },
        { success: true, time: 6000 }
      ];
      
      connections.forEach((conn, i) => {
        collector.startConnectionTiming(`session-${i}`);
        mockTime += conn.time;
        collector.completeConnectionTiming(conn.success);
      });
      
      const stats = collector.getPerformanceStats();
      
      expect(stats.totalConnections).toBe(5);
      expect(stats.successfulConnections).toBe(4);
      expect(stats.successRate).toBe(0.8); // 4/5
      expect(stats.connectionsUnder5Seconds).toBe(3); // 3000, 4000, 2000
      expect(stats.targetSuccessRate).toBe(0.6); // 3/5 under target
    });

    test('should track performance by network type', () => {
      // Mock mobile network
      mockNavigator.connection.type = 'cellular';
      collector.startConnectionTiming('mobile-session');
      mockTime += 4000;
      collector.completeConnectionTiming(true);
      
      // Mock WiFi network
      mockNavigator.connection.type = 'wifi';
      collector.startConnectionTiming('wifi-session');
      mockTime += 3000;
      collector.completeConnectionTiming(true);
      
      const stats = collector.getPerformanceStats();
      
      expect(stats.byNetworkType.mobile).toBeDefined();
      expect(stats.byNetworkType.wifi).toBeDefined();
      expect(stats.byNetworkType.mobile.connections).toBe(1);
      expect(stats.byNetworkType.wifi.connections).toBe(1);
    });

    test('should track performance by candidate type', () => {
      collector.startConnectionTiming('session-1');
      
      const turnCandidate = { candidate: 'candidate:1 1 UDP 16777215 203.0.113.2 3478 typ relay' } as RTCIceCandidate;
      collector.recordICECandidate(turnCandidate, true);
      
      mockTime += 4000;
      collector.completeConnectionTiming(true);
      
      const stats = collector.getPerformanceStats();
      
      expect(stats.byCandidateType['turn-relay']).toBeDefined();
      expect(stats.byCandidateType['turn-relay'].connections).toBe(1);
      expect(stats.byCandidateType['turn-relay'].successRate).toBe(1.0);
    });
  });

  describe('Integration Functions', () => {
    test('should work with convenience functions', () => {
      startConnectionTiming('session-1', 'user-1', 1);
      
      recordConnectionMilestone('mediaReady');
      
      const candidate = { candidate: 'candidate:1 1 UDP 2113667326 192.168.1.100 54400 typ host' } as RTCIceCandidate;
      recordICECandidateMetrics(candidate);
      
      mockTime += 4000;
      const metrics = completeConnectionTiming(true);
      
      expect(metrics.success).toBe(true);
      expect(metrics.totalConnectionTime).toBe(4000);
      
      const stats = getPerformanceStatistics();
      expect(stats.totalConnections).toBe(1);
      
      const adaptations = getNetworkAdaptations();
      expect(adaptations.currentNetwork).toBeDefined();
      
      const alerts = getPerformanceAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle missing timing gracefully', () => {
      expect(() => {
        collector.recordMilestone('mediaReady');
      }).not.toThrow();
      
      expect(() => {
        collector.completeConnectionTiming(true);
      }).toThrow('No active connection timing to complete');
    });

    test('should handle network classification errors', () => {
      // Mock navigator error
      Object.defineProperty(global, 'navigator', {
        value: undefined,
        writable: true
      });
      
      const classification = collector.classifyNetwork();
      expect(classification.type).toBe('unknown');
      expect(classification.adaptations).toContain('Use conservative TURN-first strategy');
    });
  });

  describe('Data Export and Management', () => {
    test('should export metrics correctly', () => {
      collector.startConnectionTiming('session-1');
      mockTime += 4000;
      collector.completeConnectionTiming(true);
      
      const exportData = collector.exportMetrics();
      
      expect(exportData.metrics).toHaveLength(1);
      expect(exportData.stats).toBeDefined();
      expect(exportData.exportTimestamp).toBeDefined();
    });

    test('should clear metrics correctly', () => {
      collector.startConnectionTiming('session-1');
      mockTime += 4000;
      collector.completeConnectionTiming(true);
      
      let stats = collector.getPerformanceStats();
      expect(stats.totalConnections).toBe(1);
      
      collector.clearMetrics();
      
      stats = collector.getPerformanceStats();
      expect(stats.totalConnections).toBe(0);
    });
  });
});