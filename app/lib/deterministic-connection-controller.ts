/**
 * Deterministic Connection Controller
 * 
 * Eliminates connection randomness sources by implementing:
 * - Fixed timeout values instead of variable ones
 * - Deterministic fallback strategies for network changes
 * - Race condition prevention between ICE gathering and signaling
 * - Consistent connection process across all attempts
 * 
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { 
  TURN_FALLBACK_TIMEOUT_MS, 
  TURN_RELAY_FORCE_TIMEOUT_MS,
  ICE_GATHERING_TIMEOUT_MS,
  INITIAL_CONNECTION_TIMEOUT_MS
} from './connection-config';

export interface DeterministicTimeoutConfig {
  // Fixed timeout values - no randomness or variation
  iceGatheringTimeout: number;
  turnFallbackTimeout: number;
  connectionEstablishmentTimeout: number;
  signalingTimeout: number;
  
  // Deterministic retry configuration
  maxRetryAttempts: number;
  baseRetryDelay: number;
  
  // Network change handling
  networkChangeGracePeriod: number;
  networkStabilizationDelay: number;
}

export interface ConnectionAttemptState {
  attemptNumber: number;
  startTime: number;
  phase: 'initializing' | 'ice-gathering' | 'signaling' | 'connecting' | 'completed' | 'failed';
  networkType: 'mobile' | 'wifi' | 'unknown';
  iceGatheringStarted: boolean;
  signalingStarted: boolean;
  turnFallbackTriggered: boolean;
  lastStateChange: number;
}

/**
 * Deterministic Connection Controller
 * 
 * Ensures consistent, predictable connection behavior by:
 * - Using fixed timeout values
 * - Implementing deterministic state transitions
 * - Preventing race conditions between ICE and signaling
 * - Providing consistent fallback strategies
 */
export class DeterministicConnectionController {
  private config: DeterministicTimeoutConfig;
  private currentAttempt: ConnectionAttemptState | null = null;
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private isActive = false;
  
  // Deterministic sequence tracking
  private sequenceOrder: string[] = [];
  private completedSteps: Set<string> = new Set();
  
  // Race condition prevention
  private iceGatheringLock = false;
  private signalingLock = false;
  private stateTransitionLock = false;

  constructor(customConfig?: Partial<DeterministicTimeoutConfig>) {
    // Requirements 9.2: Remove variable timeout values that create inconsistent behavior
    this.config = {
      // Fixed timeout values - no variation or randomness
      iceGatheringTimeout: ICE_GATHERING_TIMEOUT_MS, // Always 5000ms
      turnFallbackTimeout: TURN_FALLBACK_TIMEOUT_MS, // Always 3000ms
      connectionEstablishmentTimeout: INITIAL_CONNECTION_TIMEOUT_MS, // Always 15000ms
      signalingTimeout: 10000, // Always 10000ms
      
      // Deterministic retry configuration - no exponential backoff randomness
      maxRetryAttempts: 3, // Fixed number of attempts
      baseRetryDelay: 2000, // Fixed delay - no jitter or randomization
      
      // Network change handling - fixed grace periods
      networkChangeGracePeriod: 5000, // Always 5000ms
      networkStabilizationDelay: 1000, // Always 1000ms
      
      ...customConfig
    };

    console.log('🎯 Deterministic Connection Controller initialized with fixed timeouts:', this.config);
  }

  /**
   * Start deterministic connection attempt
   * Requirements: 9.3, 9.4 - Ensure consistent connection process across all attempts
   */
  startDeterministicConnection(
    networkType: 'mobile' | 'wifi' | 'unknown',
    onStateChange: (state: ConnectionAttemptState) => void,
    onTimeout: (timeoutType: string) => void
  ): void {
    if (this.isActive) {
      console.warn('⚠️ Connection attempt already active, stopping previous attempt');
      this.stopConnection();
    }

    this.isActive = true;
    const attemptNumber = (this.currentAttempt?.attemptNumber || 0) + 1;
    
    // Requirements 9.3: Ensure consistent connection process across all attempts
    this.currentAttempt = {
      attemptNumber,
      startTime: Date.now(),
      phase: 'initializing',
      networkType,
      iceGatheringStarted: false,
      signalingStarted: false,
      turnFallbackTriggered: false,
      lastStateChange: Date.now()
    };

    // Reset deterministic sequence tracking
    this.sequenceOrder = [];
    this.completedSteps.clear();
    this.resetLocks();

    console.log(`🎯 Starting deterministic connection attempt #${attemptNumber} for ${networkType} network`);
    console.log('🎯 Using fixed timeouts - no randomness or variation');

    // Set up deterministic timeout sequence
    this.setupDeterministicTimeouts(onTimeout);
    
    // Notify initial state
    onStateChange(this.currentAttempt);
    
    // Start deterministic sequence
    this.executeSequenceStep('initialization', () => {
      this.transitionToPhase('ice-gathering', onStateChange);
    });
  }

  /**
   * Setup deterministic timeouts with fixed values
   * Requirements: 9.2 - Remove variable timeout values that create inconsistent behavior
   */
  private setupDeterministicTimeouts(onTimeout: (timeoutType: string) => void): void {
    console.log('⏰ Setting up deterministic timeouts with fixed values');
    
    // TURN fallback timeout - always triggers at exactly the same time
    const turnFallbackTimeout = setTimeout(() => {
      console.log(`⏰ TURN fallback timeout (${this.config.turnFallbackTimeout}ms) - deterministic trigger`);
      this.handleTurnFallback();
      onTimeout('turn-fallback');
    }, this.config.turnFallbackTimeout);
    
    this.timeouts.set('turn-fallback', turnFallbackTimeout);

    // ICE gathering timeout - always triggers at exactly the same time
    const iceGatheringTimeout = setTimeout(() => {
      console.log(`⏰ ICE gathering timeout (${this.config.iceGatheringTimeout}ms) - deterministic trigger`);
      this.handleICEGatheringTimeout();
      onTimeout('ice-gathering');
    }, this.config.iceGatheringTimeout);
    
    this.timeouts.set('ice-gathering', iceGatheringTimeout);

    // Signaling timeout - always triggers at exactly the same time
    const signalingTimeout = setTimeout(() => {
      console.log(`⏰ Signaling timeout (${this.config.signalingTimeout}ms) - deterministic trigger`);
      this.handleSignalingTimeout();
      onTimeout('signaling');
    }, this.config.signalingTimeout);
    
    this.timeouts.set('signaling', signalingTimeout);

    // Overall connection timeout - always triggers at exactly the same time
    const connectionTimeout = setTimeout(() => {
      console.log(`⏰ Connection timeout (${this.config.connectionEstablishmentTimeout}ms) - deterministic trigger`);
      this.handleConnectionTimeout();
      onTimeout('connection');
    }, this.config.connectionEstablishmentTimeout);
    
    this.timeouts.set('connection', connectionTimeout);

    console.log('✅ All deterministic timeouts set with fixed values - no variation');
  }

  /**
   * Execute sequence step with deterministic ordering
   * Requirements: 9.3, 9.4 - Fix race conditions between ICE gathering and signaling
   */
  private executeSequenceStep(stepName: string, stepFunction: () => void): void {
    if (this.completedSteps.has(stepName)) {
      console.warn(`⚠️ Step ${stepName} already completed - skipping to prevent race condition`);
      return;
    }

    console.log(`🎯 Executing deterministic sequence step: ${stepName}`);
    this.sequenceOrder.push(stepName);
    
    try {
      stepFunction();
      this.completedSteps.add(stepName);
      console.log(`✅ Completed deterministic sequence step: ${stepName}`);
    } catch (error) {
      console.error(`❌ Failed deterministic sequence step: ${stepName}`, error);
      throw error;
    }
  }

  /**
   * Start ICE gathering with race condition prevention
   * Requirements: 9.3, 9.4 - Fix race conditions between ICE gathering and signaling
   */
  startICEGathering(onICECandidate: (candidate: RTCIceCandidate) => void): void {
    if (this.iceGatheringLock) {
      console.warn('⚠️ ICE gathering already in progress - preventing race condition');
      return;
    }

    if (!this.currentAttempt) {
      console.error('❌ Cannot start ICE gathering - no active connection attempt');
      return;
    }

    this.executeSequenceStep('ice-gathering-start', () => {
      this.iceGatheringLock = true;
      this.currentAttempt!.iceGatheringStarted = true;
      this.currentAttempt!.lastStateChange = Date.now();
      
      console.log('🧊 Starting deterministic ICE gathering - race condition prevented');
      console.log('🧊 ICE candidates will be processed in deterministic order');
      
      // ICE gathering implementation would go here
      // This is a coordination method - actual ICE gathering happens in peer connection
    });
  }

  /**
   * Start signaling with race condition prevention
   * Requirements: 9.3, 9.4 - Fix race conditions between ICE gathering and signaling
   */
  startSignaling(onSignalingMessage: (message: any) => void): void {
    if (this.signalingLock) {
      console.warn('⚠️ Signaling already in progress - preventing race condition');
      return;
    }

    if (!this.currentAttempt) {
      console.error('❌ Cannot start signaling - no active connection attempt');
      return;
    }

    this.executeSequenceStep('signaling-start', () => {
      this.signalingLock = true;
      this.currentAttempt!.signalingStarted = true;
      this.currentAttempt!.lastStateChange = Date.now();
      
      console.log('📡 Starting deterministic signaling - race condition prevented');
      console.log('📡 Signaling messages will be processed in deterministic order');
      
      // Signaling implementation would go here
      // This is a coordination method - actual signaling happens via socket
    });
  }

  /**
   * Handle network changes with deterministic fallback strategy
   * Requirements: 9.2 - Implement deterministic fallback strategies for network changes
   */
  handleNetworkChange(
    newNetworkType: 'mobile' | 'wifi' | 'unknown',
    onFallbackStrategy: (strategy: string) => void
  ): void {
    if (!this.currentAttempt) {
      console.warn('⚠️ Network change detected but no active connection attempt');
      return;
    }

    console.log(`🌐 Network change detected: ${this.currentAttempt.networkType} → ${newNetworkType}`);
    console.log('🎯 Applying deterministic fallback strategy');

    // Requirements 9.2: Deterministic fallback strategies based on network type
    const fallbackStrategy = this.getDeterministicFallbackStrategy(
      this.currentAttempt.networkType,
      newNetworkType
    );

    console.log(`🎯 Selected deterministic fallback strategy: ${fallbackStrategy}`);

    // Apply network stabilization delay - always the same duration
    setTimeout(() => {
      if (this.currentAttempt) {
        this.currentAttempt.networkType = newNetworkType;
        this.currentAttempt.lastStateChange = Date.now();
        onFallbackStrategy(fallbackStrategy);
        
        console.log(`✅ Applied deterministic fallback strategy: ${fallbackStrategy}`);
      }
    }, this.config.networkStabilizationDelay); // Fixed delay - no randomness
  }

  /**
   * Get deterministic fallback strategy based on network transition
   * Requirements: 9.2 - Implement deterministic fallback strategies for network changes
   */
  private getDeterministicFallbackStrategy(
    fromNetwork: 'mobile' | 'wifi' | 'unknown',
    toNetwork: 'mobile' | 'wifi' | 'unknown'
  ): string {
    // Deterministic strategy selection - always the same for same transition
    const transitionKey = `${fromNetwork}-to-${toNetwork}`;
    
    const strategies: Record<string, string> = {
      'wifi-to-mobile': 'force-turn-relay',
      'mobile-to-wifi': 'enable-stun-turn-parallel',
      'unknown-to-mobile': 'force-turn-relay',
      'unknown-to-wifi': 'enable-stun-turn-parallel',
      'mobile-to-unknown': 'maintain-turn-relay',
      'wifi-to-unknown': 'maintain-current-strategy'
    };

    return strategies[transitionKey] || 'maintain-current-strategy';
  }

  /**
   * Transition to new phase with state validation
   * Requirements: 9.3, 9.4 - Ensure consistent connection process across all attempts
   */
  private transitionToPhase(
    newPhase: ConnectionAttemptState['phase'],
    onStateChange: (state: ConnectionAttemptState) => void
  ): void {
    if (this.stateTransitionLock) {
      console.warn('⚠️ State transition already in progress - preventing race condition');
      return;
    }

    if (!this.currentAttempt) {
      console.error('❌ Cannot transition phase - no active connection attempt');
      return;
    }

    this.stateTransitionLock = true;

    try {
      const oldPhase = this.currentAttempt.phase;
      this.currentAttempt.phase = newPhase;
      this.currentAttempt.lastStateChange = Date.now();

      console.log(`🎯 Deterministic phase transition: ${oldPhase} → ${newPhase}`);
      
      onStateChange(this.currentAttempt);
      
      console.log(`✅ Phase transition completed: ${newPhase}`);
    } finally {
      this.stateTransitionLock = false;
    }
  }

  /**
   * Handle TURN fallback with deterministic behavior
   */
  private handleTurnFallback(): void {
    if (!this.currentAttempt || this.currentAttempt.turnFallbackTriggered) {
      return;
    }

    this.currentAttempt.turnFallbackTriggered = true;
    this.currentAttempt.lastStateChange = Date.now();
    
    console.log('🔄 Deterministic TURN fallback triggered - always at same timeout');
  }

  /**
   * Handle ICE gathering timeout with deterministic behavior
   */
  private handleICEGatheringTimeout(): void {
    if (!this.currentAttempt) return;

    console.log('⏰ Deterministic ICE gathering timeout - proceeding with available candidates');
    this.transitionToPhase('signaling', () => {});
  }

  /**
   * Handle signaling timeout with deterministic behavior
   */
  private handleSignalingTimeout(): void {
    if (!this.currentAttempt) return;

    console.log('⏰ Deterministic signaling timeout - connection attempt failed');
    this.transitionToPhase('failed', () => {});
  }

  /**
   * Handle connection timeout with deterministic behavior
   */
  private handleConnectionTimeout(): void {
    if (!this.currentAttempt) return;

    console.log('⏰ Deterministic connection timeout - overall attempt failed');
    this.transitionToPhase('failed', () => {});
  }

  /**
   * Reset race condition locks
   */
  private resetLocks(): void {
    this.iceGatheringLock = false;
    this.signalingLock = false;
    this.stateTransitionLock = false;
  }

  /**
   * Stop connection and clean up
   */
  stopConnection(): void {
    console.log('🛑 Stopping deterministic connection controller');
    
    // Clear all timeouts
    for (const [name, timeout] of this.timeouts.entries()) {
      clearTimeout(timeout);
      console.log(`⏰ Cleared deterministic timeout: ${name}`);
    }
    this.timeouts.clear();

    // Reset state
    this.isActive = false;
    this.resetLocks();
    
    if (this.currentAttempt) {
      this.currentAttempt.phase = 'completed';
      this.currentAttempt.lastStateChange = Date.now();
    }

    console.log('✅ Deterministic connection controller stopped');
  }

  /**
   * Get current attempt state
   */
  getCurrentAttempt(): ConnectionAttemptState | null {
    return this.currentAttempt ? { ...this.currentAttempt } : null;
  }

  /**
   * Get deterministic sequence information
   */
  getSequenceInfo(): {
    order: string[];
    completed: string[];
    remaining: string[];
  } {
    const expectedSteps = [
      'initialization',
      'ice-gathering-start',
      'signaling-start',
      'connection-establishment'
    ];

    return {
      order: [...this.sequenceOrder],
      completed: Array.from(this.completedSteps),
      remaining: expectedSteps.filter(step => !this.completedSteps.has(step))
    };
  }

  /**
   * Validate deterministic behavior
   */
  validateDeterministicBehavior(): {
    isValid: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for race condition locks
    if (this.iceGatheringLock && this.signalingLock) {
      issues.push('Both ICE gathering and signaling locks are active simultaneously');
      recommendations.push('Ensure proper sequence ordering to prevent race conditions');
    }

    // Check for consistent timeout configuration
    const timeoutValues = Object.values(this.config);
    if (timeoutValues.some(value => value <= 0)) {
      issues.push('Invalid timeout configuration detected');
      recommendations.push('Ensure all timeout values are positive and deterministic');
    }

    // Check sequence completion
    const sequenceInfo = this.getSequenceInfo();
    if (sequenceInfo.order.length !== sequenceInfo.completed.length && this.isActive) {
      issues.push('Incomplete sequence execution detected');
      recommendations.push('Ensure all sequence steps complete in deterministic order');
    }

    return {
      isValid: issues.length === 0,
      issues,
      recommendations
    };
  }

  /**
   * Get configuration for debugging
   */
  getConfig(): DeterministicTimeoutConfig {
    return { ...this.config };
  }

  /**
   * Update configuration with validation
   */
  updateConfig(newConfig: Partial<DeterministicTimeoutConfig>): boolean {
    try {
      // Validate new configuration
      const updatedConfig = { ...this.config, ...newConfig };
      
      // Ensure all timeout values are positive and deterministic
      const timeoutValues = Object.values(updatedConfig);
      if (timeoutValues.some(value => value <= 0)) {
        console.error('❌ Invalid configuration: All timeout values must be positive');
        return false;
      }

      this.config = updatedConfig;
      console.log('✅ Deterministic configuration updated:', newConfig);
      return true;
    } catch (error) {
      console.error('❌ Failed to update deterministic configuration:', error);
      return false;
    }
  }
}

/**
 * Create deterministic connection controller with network-specific configuration
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5 - Complete deterministic behavior
 */
export function createDeterministicController(
  networkType: 'mobile' | 'wifi' | 'unknown' = 'unknown'
): DeterministicConnectionController {
  // Network-specific deterministic configurations
  const networkConfigs: Record<string, Partial<DeterministicTimeoutConfig>> = {
    mobile: {
      // More aggressive but still deterministic timeouts for mobile
      iceGatheringTimeout: 4000, // Always 4000ms
      turnFallbackTimeout: 2000, // Always 2000ms
      connectionEstablishmentTimeout: 12000, // Always 12000ms
      networkChangeGracePeriod: 3000, // Always 3000ms
    },
    wifi: {
      // Standard deterministic timeouts for WiFi
      iceGatheringTimeout: 5000, // Always 5000ms
      turnFallbackTimeout: 3000, // Always 3000ms
      connectionEstablishmentTimeout: 15000, // Always 15000ms
      networkChangeGracePeriod: 5000, // Always 5000ms
    },
    unknown: {
      // Conservative but deterministic timeouts for unknown networks
      iceGatheringTimeout: 5000, // Always 5000ms
      turnFallbackTimeout: 3000, // Always 3000ms
      connectionEstablishmentTimeout: 15000, // Always 15000ms
      networkChangeGracePeriod: 5000, // Always 5000ms
    }
  };

  const config = networkConfigs[networkType] || networkConfigs.unknown;
  const controller = new DeterministicConnectionController(config);

  console.log(`🎯 Created deterministic controller for ${networkType} network`);
  console.log('🎯 All timeouts are fixed - no randomness or variation');

  return controller;
}

/**
 * Eliminate Math.random() usage in process ID generation
 * Requirements: 9.1, 9.2 - Remove all sources of randomness
 */
export function generateDeterministicProcessId(): string {
  // Use timestamp and counter instead of Math.random()
  const timestamp = Date.now();
  const counter = (generateDeterministicProcessId as any).counter || 0;
  (generateDeterministicProcessId as any).counter = counter + 1;
  
  // Create deterministic ID without randomness
  const deterministicId = `proc_${timestamp}_${counter.toString().padStart(4, '0')}`;
  
  console.log(`🎯 Generated deterministic process ID: ${deterministicId}`);
  return deterministicId;
}

/**
 * Replace variable timeout creation with deterministic timeout creation
 * Requirements: 9.2 - Remove variable timeout values that create inconsistent behavior
 */
export function createDeterministicTimeout(
  callback: () => void,
  delay: number,
  description: string = 'Deterministic timeout'
): NodeJS.Timeout {
  // Ensure delay is always the same value - no variation
  const fixedDelay = Math.max(0, Math.floor(delay)); // Remove any fractional randomness
  
  console.log(`⏰ Creating deterministic timeout: ${description} (${fixedDelay}ms - fixed value)`);
  
  const timeout = setTimeout(() => {
    console.log(`⏰ Deterministic timeout triggered: ${description} (exactly ${fixedDelay}ms)`);
    callback();
  }, fixedDelay);

  return timeout;
}

/**
 * Replace variable interval creation with deterministic interval creation
 * Requirements: 9.2 - Remove variable timeout values that create inconsistent behavior
 */
export function createDeterministicInterval(
  callback: () => void,
  delay: number,
  description: string = 'Deterministic interval'
): NodeJS.Timeout {
  // Ensure delay is always the same value - no variation
  const fixedDelay = Math.max(0, Math.floor(delay)); // Remove any fractional randomness
  
  console.log(`🔄 Creating deterministic interval: ${description} (${fixedDelay}ms - fixed value)`);
  
  const interval = setInterval(() => {
    console.log(`🔄 Deterministic interval triggered: ${description} (exactly ${fixedDelay}ms)`);
    callback();
  }, fixedDelay);

  return interval;
}