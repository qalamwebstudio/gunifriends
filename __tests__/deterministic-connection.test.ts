/**
 * Deterministic Connection Tests
 * 
 * Tests for Task 9: Eliminate Connection Randomness Sources
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { 
  DeterministicConnectionController,
  createDeterministicController,
  generateDeterministicProcessId,
  createDeterministicTimeout,
  createDeterministicInterval
} from '../app/lib/deterministic-connection-controller';

import { 
  RaceConditionPrevention,
  getRaceConditionPrevention,
  resetGlobalRaceConditionPrevention,
  executeWithRaceConditionPrevention,
  coordinateICEAndSignaling
} from '../app/lib/race-condition-prevention';

import { 
  ConsistentConnectionProcess,
  getConsistentConnectionProcess,
  resetGlobalConsistentConnectionProcess,
  startConsistentConnection
} from '../app/lib/consistent-connection-process';

describe('Task 9: Eliminate Connection Randomness Sources', () => {
  beforeEach(() => {
    // Reset global instances before each test
    resetGlobalRaceConditionPrevention();
    resetGlobalConsistentConnectionProcess();
    
    // Clear any existing timeouts/intervals
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('9.1: Remove Math.random() usage in process ID generation', () => {
    test('should generate deterministic process IDs without Math.random()', () => {
      // Generate multiple IDs
      const ids = [];
      for (let i = 0; i < 10; i++) {
        ids.push(generateDeterministicProcessId());
      }

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);

      // IDs should follow deterministic pattern (timestamp + counter)
      ids.forEach(id => {
        expect(id).toMatch(/^proc_\d+_\d{4}$/);
      });

      // IDs should be sequential in counter part
      const counters = ids.map(id => parseInt(id.split('_')[2]));
      for (let i = 1; i < counters.length; i++) {
        expect(counters[i]).toBe(counters[i-1] + 1);
      }
    });

    test('should not use Math.random() in process ID generation', () => {
      const originalRandom = Math.random;
      let randomCalled = false;
      
      Math.random = jest.fn(() => {
        randomCalled = true;
        return 0.5;
      });

      try {
        // Generate multiple process IDs
        for (let i = 0; i < 5; i++) {
          generateDeterministicProcessId();
        }

        // Math.random should never be called
        expect(randomCalled).toBe(false);
        expect(Math.random).not.toHaveBeenCalled();
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  describe('9.2: Remove variable timeout values that create inconsistent behavior', () => {
    test('should use fixed timeout values without variation', () => {
      const controller = new DeterministicConnectionController();
      const config = controller.getConfig();

      // All timeout values should be fixed positive numbers
      expect(config.iceGatheringTimeout).toBe(5000);
      expect(config.turnFallbackTimeout).toBe(3000);
      expect(config.connectionEstablishmentTimeout).toBe(15000);
      expect(config.signalingTimeout).toBe(10000);
      expect(config.baseRetryDelay).toBe(2000);
      expect(config.networkChangeGracePeriod).toBe(5000);
      expect(config.networkStabilizationDelay).toBe(1000);
    });

    test('should create deterministic timeouts with fixed delays', () => {
      jest.useFakeTimers();
      
      const callback = jest.fn();
      const fixedDelay = 1000;
      
      // Create multiple timeouts with same delay
      const timeouts = [];
      for (let i = 0; i < 3; i++) {
        timeouts.push(createDeterministicTimeout(callback, fixedDelay, `Test timeout ${i}`));
      }

      // All timeouts should be created
      expect(timeouts).toHaveLength(3);
      timeouts.forEach(timeout => {
        expect(timeout).toBeDefined();
      });

      // Fast-forward time by exactly the fixed delay
      jest.advanceTimersByTime(fixedDelay);

      // All callbacks should have been called exactly once
      expect(callback).toHaveBeenCalledTimes(3);

      jest.useRealTimers();
    });

    test('should create deterministic intervals with fixed delays', () => {
      jest.useFakeTimers();
      
      const callback = jest.fn();
      const fixedDelay = 500;
      
      const interval = createDeterministicInterval(callback, fixedDelay, 'Test interval');
      expect(interval).toBeDefined();

      // Fast-forward time by multiple intervals
      jest.advanceTimersByTime(fixedDelay * 3);

      // Callback should have been called exactly 3 times
      expect(callback).toHaveBeenCalledTimes(3);

      clearInterval(interval!);
      jest.useRealTimers();
    });

    test('should implement deterministic fallback strategies', async () => {
      const controller = new DeterministicConnectionController();
      
      // Mock network change handler
      const fallbackStrategies: string[] = [];
      const onFallbackStrategy = (strategy: string) => {
        fallbackStrategies.push(strategy);
      };

      // Start a connection attempt first
      controller.startDeterministicConnection(
        'wifi',
        () => {}, // onStateChange
        () => {}  // onTimeout
      );

      // Test different network transitions
      controller.handleNetworkChange('mobile', onFallbackStrategy);
      controller.handleNetworkChange('wifi', onFallbackStrategy);
      controller.handleNetworkChange('mobile', onFallbackStrategy);

      // Wait for stabilization delays
      await new Promise(resolve => {
        setTimeout(() => {
          // Should have deterministic strategies for each transition
          expect(fallbackStrategies).toContain('force-turn-relay');
          expect(fallbackStrategies).toContain('enable-stun-turn-parallel');
          resolve(undefined);
        }, 1200); // Wait for network stabilization delay + buffer
      });
    });
  });

  describe('9.3: Fix race conditions between ICE gathering and signaling', () => {
    test('should prevent race conditions with operation locks', async () => {
      const racePreventionManager = new RaceConditionPrevention();
      
      const owner = 'test-owner';
      const operationName = 'test-operation';

      // Acquire lock
      const lockAcquired = await racePreventionManager.acquireOperationLock(operationName, owner);
      expect(lockAcquired).toBe(true);

      // Try to acquire same lock again - should fail
      const secondLockAcquired = await racePreventionManager.acquireOperationLock(operationName, 'other-owner');
      expect(secondLockAcquired).toBe(false);

      // Release lock
      const lockReleased = racePreventionManager.releaseOperationLock(operationName, owner);
      expect(lockReleased).toBe(true);

      // Now should be able to acquire lock again
      const thirdLockAcquired = await racePreventionManager.acquireOperationLock(operationName, 'other-owner');
      expect(thirdLockAcquired).toBe(true);
    });

    test('should coordinate ICE gathering and signaling to prevent race conditions', async () => {
      const racePreventionManager = getRaceConditionPrevention();
      
      let iceGatheringStarted = false;
      let signalingStarted = false;
      const executionOrder: string[] = [];

      const iceGatheringOperation = async () => {
        executionOrder.push('ice-gathering');
        iceGatheringStarted = true;
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      const signalingOperation = async () => {
        executionOrder.push('signaling');
        signalingStarted = true;
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      // Update sequence state to allow coordination
      racePreventionManager.updateSequenceState({ 
        mediaReady: true,
        peerConnectionCreated: true,
        tracksAttached: true 
      });

      // Manually mark prerequisite steps as completed
      const status = racePreventionManager.getStatus();
      status.completedSteps.push('track-attachment');

      // Coordinate operations
      await racePreventionManager.coordinateICEAndSignaling(
        iceGatheringOperation,
        signalingOperation,
        'test-owner'
      );

      // Both operations should have completed
      expect(iceGatheringStarted).toBe(true);
      expect(signalingStarted).toBe(true);

      // ICE gathering should have started before signaling
      expect(executionOrder).toEqual(['ice-gathering', 'signaling']);
    });

    test('should validate sequence order to prevent execution violations', () => {
      const racePreventionManager = new RaceConditionPrevention();

      // Should fail validation for steps without prerequisites
      expect(racePreventionManager.validateSequenceOrder('signaling-start')).toBe(false);
      expect(racePreventionManager.validateSequenceOrder('ice-gathering-start')).toBe(false);

      // Complete prerequisites in order by executing operations
      racePreventionManager.updateSequenceState({ 
        mediaReady: true,
        peerConnectionCreated: true,
        tracksAttached: true 
      });

      // Execute prerequisite operations to mark them as completed
      return Promise.all([
        racePreventionManager.executeWithLock('media-access', 'test', async () => {}),
        racePreventionManager.executeWithLock('peer-connection-creation', 'test', async () => {}, ['media-access']),
        racePreventionManager.executeWithLock('track-attachment', 'test', async () => {}, ['media-access', 'peer-connection-creation'])
      ]).then(() => {
        // Now should pass validation
        expect(racePreventionManager.validateSequenceOrder('ice-gathering-start')).toBe(true);
      });
    });
  });

  describe('9.4: Ensure consistent connection process across all attempts', () => {
    test('should follow standardized connection steps', async () => {
      const processManager = new ConsistentConnectionProcess();
      const standardSteps = processManager.getStandardSteps();

      // Should have all required steps
      const expectedSteps = [
        'media-access',
        'peer-connection-creation',
        'track-attachment',
        'ice-configuration',
        'ice-gathering',
        'signaling-setup',
        'offer-creation',
        'local-description-set',
        'offer-transmission',
        'answer-reception',
        'remote-description-set',
        'ice-candidate-exchange',
        'connection-establishment'
      ];

      const stepNames = standardSteps.map(step => step.name);
      expectedSteps.forEach(expectedStep => {
        expect(stepNames).toContain(expectedStep);
      });

      // All steps should have fixed timeouts
      standardSteps.forEach(step => {
        expect(step.timeout).toBeGreaterThan(0);
        expect(Number.isInteger(step.timeout)).toBe(true);
      });
    });

    test('should validate process template consistency', () => {
      const processManager = new ConsistentConnectionProcess();
      
      // Process template should be valid
      expect(processManager.validateProcessTemplate()).toBe(true);
    });

    test('should track process consistency across attempts', async () => {
      const processManager = getConsistentConnectionProcess();
      
      // Mock progress callbacks
      const progressUpdates: Array<{step: string, progress: number}> = [];
      const stepCompletions: Array<{step: string, success: boolean, duration: number}> = [];

      const onProgress = (step: string, progress: number) => {
        progressUpdates.push({ step, progress });
      };

      const onStepComplete = (step: string, success: boolean, duration: number) => {
        stepCompletions.push({ step, success, duration });
      };

      // Start consistent connection attempt
      const attemptLog = await processManager.startConsistentConnectionAttempt(
        'wifi',
        onProgress,
        onStepComplete
      );

      // Should have completed all steps
      expect(attemptLog.steps.length).toBeGreaterThan(0);
      expect(attemptLog.finalResult).toBe('success');
      expect(attemptLog.totalDuration).toBeGreaterThan(0);

      // Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(stepCompletions.length).toBeGreaterThan(0);

      // Get consistency statistics
      const stats = processManager.getConsistencyStatistics();
      expect(stats.totalAttempts).toBe(1);
      expect(stats.consistencyScore).toBe(100); // Perfect consistency for single attempt
    });
  });

  describe('9.5: Comprehensive deterministic behavior validation', () => {
    test('should validate deterministic controller behavior', () => {
      const controller = new DeterministicConnectionController();
      
      const validation = controller.validateDeterministicBehavior();
      
      // Should be valid initially
      expect(validation.isValid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    test('should provide deterministic sequence information', () => {
      const controller = new DeterministicConnectionController();
      
      const sequenceInfo = controller.getSequenceInfo();
      
      // Should have proper sequence structure
      expect(sequenceInfo.order).toBeInstanceOf(Array);
      expect(sequenceInfo.completed).toBeInstanceOf(Array);
      expect(sequenceInfo.remaining).toBeInstanceOf(Array);
    });

    test('should create network-specific deterministic controllers', () => {
      const mobileController = createDeterministicController('mobile');
      const wifiController = createDeterministicController('wifi');
      const unknownController = createDeterministicController('unknown');

      // All controllers should be created
      expect(mobileController).toBeInstanceOf(DeterministicConnectionController);
      expect(wifiController).toBeInstanceOf(DeterministicConnectionController);
      expect(unknownController).toBeInstanceOf(DeterministicConnectionController);

      // Should have different configurations for different networks
      const mobileConfig = mobileController.getConfig();
      const wifiConfig = wifiController.getConfig();

      // Mobile should have more aggressive timeouts
      expect(mobileConfig.iceGatheringTimeout).toBeLessThanOrEqual(wifiConfig.iceGatheringTimeout);
      expect(mobileConfig.turnFallbackTimeout).toBeLessThanOrEqual(wifiConfig.turnFallbackTimeout);
    });

    test('should execute operations with race condition prevention', async () => {
      const executionOrder: string[] = [];
      
      const operation1 = async () => {
        executionOrder.push('operation1');
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      const operation2 = async () => {
        executionOrder.push('operation2');
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      // Execute operations with race condition prevention
      await Promise.all([
        executeWithRaceConditionPrevention('test-op-1', operation1),
        executeWithRaceConditionPrevention('test-op-2', operation2)
      ]);

      // Both operations should have completed
      expect(executionOrder).toContain('operation1');
      expect(executionOrder).toContain('operation2');
      expect(executionOrder).toHaveLength(2);
    });

    test('should maintain consistent behavior across multiple attempts', async () => {
      const processManager = getConsistentConnectionProcess();
      const attemptLogs: any[] = [];

      // Run multiple connection attempts
      for (let i = 0; i < 3; i++) {
        const attemptLog = await processManager.startConsistentConnectionAttempt(
          'wifi',
          () => {}, // onProgress
          () => {}  // onStepComplete
        );
        attemptLogs.push(attemptLog);
      }

      // All attempts should follow the same process
      const firstAttemptSteps = attemptLogs[0].steps.map((s: any) => s.name);
      
      for (let i = 1; i < attemptLogs.length; i++) {
        const currentAttemptSteps = attemptLogs[i].steps.map((s: any) => s.name);
        expect(currentAttemptSteps).toEqual(firstAttemptSteps);
      }

      // Get final consistency statistics
      const stats = processManager.getConsistencyStatistics();
      expect(stats.totalAttempts).toBe(3);
      expect(stats.consistencyScore).toBe(100); // Perfect consistency
      expect(stats.processVariations).toBe(1); // All attempts should follow same pattern
    });
  });

  describe('Integration: Complete deterministic connection flow', () => {
    test('should eliminate all randomness sources in complete flow', async () => {
      // Track all random calls
      const originalRandom = Math.random;
      let randomCallCount = 0;
      
      Math.random = jest.fn(() => {
        randomCallCount++;
        return 0.5;
      });

      try {
        // Create deterministic controller
        const controller = createDeterministicController('wifi');
        
        // Generate process IDs
        const processIds = [];
        for (let i = 0; i < 5; i++) {
          processIds.push(generateDeterministicProcessId());
        }

        // Start race condition prevention
        const racePreventionManager = getRaceConditionPrevention();
        
        // Execute operations with race prevention
        await executeWithRaceConditionPrevention('test-operation', async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        });

        // Start consistent connection process
        const processManager = getConsistentConnectionProcess();
        await processManager.startConsistentConnectionAttempt(
          'wifi',
          () => {}, // onProgress
          () => {}  // onStepComplete
        );

        // Math.random should never have been called
        expect(randomCallCount).toBe(0);
        expect(Math.random).not.toHaveBeenCalled();

        // All process IDs should be deterministic
        processIds.forEach(id => {
          expect(id).toMatch(/^proc_\d+_\d{4}$/);
        });

      } finally {
        Math.random = originalRandom;
      }
    });

    test('should provide comprehensive deterministic behavior validation', () => {
      // Test all deterministic components together
      const controller = createDeterministicController('wifi');
      const racePreventionManager = getRaceConditionPrevention();
      const processManager = getConsistentConnectionProcess();

      // Validate deterministic controller
      const controllerValidation = controller.validateDeterministicBehavior();
      expect(controllerValidation.isValid).toBe(true);

      // Validate race condition prevention status
      const racePreventionStatus = racePreventionManager.getStatus();
      expect(racePreventionStatus.sequenceState).toBeDefined();
      expect(racePreventionStatus.activeLocks).toBeInstanceOf(Array);

      // Validate consistent process
      const processValidation = processManager.validateProcessTemplate();
      expect(processValidation).toBe(true);

      // Get consistency statistics
      const consistencyStats = processManager.getConsistencyStatistics();
      expect(consistencyStats.consistencyScore).toBeGreaterThanOrEqual(0);
      expect(consistencyStats.consistencyScore).toBeLessThanOrEqual(100);
    });
  });
});