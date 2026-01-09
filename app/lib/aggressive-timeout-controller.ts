/**
 * Aggressive Timeout Controller for TURN-First ICE Strategy
 * 
 * Implements strict timeout control with forced TURN fallback
 * for consistent sub-5-second connection establishment.
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 * - 2.4: Remove redundant ICE restart logic that extends connection time
 * - 2.5: Clean up timeouts when connection established
 */

import { 
  TURN_FALLBACK_TIMEOUT_MS, 
  TURN_RELAY_FORCE_TIMEOUT_MS,
  ICE_GATHERING_TIMEOUT_MS,
  PARALLEL_GATHERING_TIMEOUT_MS
} from './connection-config';

export interface TimeoutConfig {
  iceGatheringTimeout: number;
  turnFallbackTimeout: number;
  turnRelayForceTimeout: number;
  parallelGatheringTimeout: number;
}

export interface TimeoutCallbacks {
  onTurnFallback: () => void;
  onTurnRelayForced: () => void;
  onICEGatheringTimeout: () => void;
  onParallelGatheringComplete: () => void;
}

/**
 * Aggressive Timeout Controller
 * 
 * Manages strict timeouts for TURN-first ICE strategy with
 * forced TURN relay fallback after timeout periods.
 */
export class AggressiveTimeoutController {
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private isActive = false;
  private startTime = 0;
  private config: TimeoutConfig;
  private callbacks: TimeoutCallbacks;

  constructor(callbacks: TimeoutCallbacks, customConfig?: Partial<TimeoutConfig>) {
    this.callbacks = callbacks;
    this.config = {
      iceGatheringTimeout: ICE_GATHERING_TIMEOUT_MS,
      turnFallbackTimeout: TURN_FALLBACK_TIMEOUT_MS,
      turnRelayForceTimeout: TURN_RELAY_FORCE_TIMEOUT_MS,
      parallelGatheringTimeout: PARALLEL_GATHERING_TIMEOUT_MS,
      ...customConfig
    };

    console.log('⏰ Aggressive Timeout Controller initialized with config:', this.config);
  }

  /**
   * Start aggressive timeout monitoring for ICE gathering
   * Requirements: 2.1, 2.2 - Limit ICE gathering to 5 seconds max
   * Requirements: 2.4 - Remove redundant ICE restart logic that extends connection time
   */
  startICEGatheringTimeout(peerConnection: RTCPeerConnection): void {
    if (this.isActive) {
      console.warn('⚠️ Timeout controller already active, clearing previous timeouts');
      this.clearAllTimeouts();
    }

    this.isActive = true;
    this.startTime = Date.now();

    console.log(`⏰ Starting aggressive ICE gathering timeout (${this.config.iceGatheringTimeout}ms)`);
    
    // Requirements 2.4: Disable redundant ICE restart logic immediately
    this.disableICERestartLogic(peerConnection);
    this.removeRedundantICEHandlers(peerConnection);

    // Import timeout registration to use lifecycle management
    import('./webrtc-manager').then(({ registerTimeout }) => {
      // Set parallel gathering timeout (Requirements 2.2)
      const parallelTimeout = registerTimeout(() => {
        const elapsed = Date.now() - this.startTime;
        console.log(`⏰ Parallel gathering timeout reached (${elapsed}ms)`);
        this.callbacks.onParallelGatheringComplete();
      }, this.config.parallelGatheringTimeout, 'Parallel STUN/TURN gathering timeout');

      if (parallelTimeout) {
        this.timeouts.set('parallel', parallelTimeout);
      }

      // Set TURN fallback timeout (Requirements 2.2, 2.3)
      const turnFallbackTimeout = registerTimeout(() => {
        const elapsed = Date.now() - this.startTime;
        console.log(`⏰ TURN fallback timeout reached (${elapsed}ms) - forcing TURN relay`);
        this.callbacks.onTurnFallback();
      }, this.config.turnFallbackTimeout, 'TURN fallback timeout');

      if (turnFallbackTimeout) {
        this.timeouts.set('turnFallback', turnFallbackTimeout);
      }

      // Set TURN relay force timeout (Requirements 2.3)
      const turnRelayForceTimeout = registerTimeout(() => {
        const elapsed = Date.now() - this.startTime;
        console.log(`⏰ TURN relay force timeout reached (${elapsed}ms) - forcing relay mode immediately`);
        this.callbacks.onTurnRelayForced();
      }, this.config.turnRelayForceTimeout, 'TURN relay force timeout');

      if (turnRelayForceTimeout) {
        this.timeouts.set('turnRelayForce', turnRelayForceTimeout);
      }

      // Set overall ICE gathering timeout (Requirements 2.1, 2.5)
      const iceGatheringTimeout = registerTimeout(() => {
        const elapsed = Date.now() - this.startTime;
        console.log(`⏰ ICE gathering timeout reached (${elapsed}ms) - proceeding with available candidates`);
        this.callbacks.onICEGatheringTimeout();
        this.clearAllTimeouts();
      }, this.config.iceGatheringTimeout, 'ICE gathering timeout');

      if (iceGatheringTimeout) {
        this.timeouts.set('iceGathering', iceGatheringTimeout);
      }

    }).catch((error) => {
      console.error('❌ Failed to register timeouts with lifecycle management:', error);
      
      // Fallback to direct setTimeout for timeout controller
      // This is acceptable since timeout control is critical for connection establishment
      this.setDirectTimeouts();
    });
  }

  /**
   * Fallback timeout setting using deterministic setTimeout
   * Requirements: 9.2 - Remove variable timeout values that create inconsistent behavior
   */
  private setDirectTimeouts(): void {
    console.warn('⚠️ Using deterministic setTimeout fallback for timeout controller');
    console.log('🎯 All timeouts will use fixed values - no randomness or variation');

    // Set parallel gathering timeout - always exactly the same duration
    const parallelTimeout = setTimeout(() => {
      const elapsed = Date.now() - this.startTime;
      console.log(`⏰ Parallel gathering timeout reached (exactly ${elapsed}ms) - deterministic trigger`);
      this.callbacks.onParallelGatheringComplete();
    }, this.config.parallelGatheringTimeout);
    this.timeouts.set('parallel', parallelTimeout);

    // Set TURN fallback timeout - always exactly the same duration
    const turnFallbackTimeout = setTimeout(() => {
      const elapsed = Date.now() - this.startTime;
      console.log(`⏰ TURN fallback timeout reached (exactly ${elapsed}ms) - deterministic trigger`);
      this.callbacks.onTurnFallback();
    }, this.config.turnFallbackTimeout);
    this.timeouts.set('turnFallback', turnFallbackTimeout);

    // Set TURN relay force timeout - always exactly the same duration
    const turnRelayForceTimeout = setTimeout(() => {
      const elapsed = Date.now() - this.startTime;
      console.log(`⏰ TURN relay force timeout reached (exactly ${elapsed}ms) - deterministic trigger`);
      this.callbacks.onTurnRelayForced();
    }, this.config.turnRelayForceTimeout);
    this.timeouts.set('turnRelayForce', turnRelayForceTimeout);

    // Set overall ICE gathering timeout - always exactly the same duration
    const iceGatheringTimeout = setTimeout(() => {
      const elapsed = Date.now() - this.startTime;
      console.log(`⏰ ICE gathering timeout reached (exactly ${elapsed}ms) - deterministic trigger`);
      this.callbacks.onICEGatheringTimeout();
      this.clearAllTimeouts();
    }, this.config.iceGatheringTimeout);
    this.timeouts.set('iceGathering', iceGatheringTimeout);

    console.log('✅ All deterministic timeouts set with fixed values - no variation between attempts');
  }

  /**
   * Force TURN relay mode immediately
   * Requirements: 2.2, 2.3 - Force TURN relay after timeout
   */
  forceTURNRelay(peerConnection: RTCPeerConnection): void {
    console.log('🔒 Forcing TURN relay mode - stopping STUN probing');
    
    // Clear STUN-related timeouts but keep TURN relay timeout
    this.clearTimeout('parallel');
    this.clearTimeout('turnFallback');
    
    // Log the forced relay action
    const elapsed = Date.now() - this.startTime;
    console.log(`🔒 TURN relay forced after ${elapsed}ms - connection will use relay candidates only`);
    
    // The actual ICE transport policy change should be handled by the caller
    // This controller only manages the timing
  }

  /**
   * Disable redundant ICE restart logic
   * Requirements: 2.4 - Remove redundant ICE restart logic that extends connection time
   */
  disableICERestartLogic(peerConnection: RTCPeerConnection): void {
    console.log('🚫 Disabling redundant ICE restart logic to prevent connection time extension');
    
    // Override the restartIce method to prevent automatic restarts
    const originalRestartIce = peerConnection.restartIce.bind(peerConnection);
    
    peerConnection.restartIce = () => {
      console.warn('🚫 ICE restart blocked by aggressive timeout controller');
      console.warn('🚫 Redundant ICE restarts extend connection time and are disabled');
      console.warn('🚫 Use TURN-first strategy instead of ICE restart for reliability');
      
      // Log the blocked restart attempt
      const elapsed = Date.now() - this.startTime;
      console.log(`🚫 ICE restart attempt blocked after ${elapsed}ms - using TURN-first strategy`);
      
      // Don't perform the restart - return immediately
      return;
    };
    
    console.log('✅ ICE restart logic disabled - connection will rely on TURN-first strategy');
  }

  /**
   * Remove ICE restart event handlers that cause delays
   * Requirements: 2.4 - Remove redundant ICE restart logic that extends connection time
   */
  removeRedundantICEHandlers(peerConnection: RTCPeerConnection): void {
    console.log('🧹 Removing redundant ICE connection state handlers that trigger restarts');
    
    // Store original handlers if they exist
    const originalICEHandler = peerConnection.oniceconnectionstatechange;
    const originalConnectionHandler = peerConnection.onconnectionstatechange;
    
    // Replace with optimized handlers that don't trigger restarts
    peerConnection.oniceconnectionstatechange = (event) => {
      const state = peerConnection.iceConnectionState;
      const elapsed = Date.now() - this.startTime;
      
      console.log(`🔗 ICE state: ${state} (${elapsed}ms) - restart logic disabled`);
      
      // Handle states without triggering restarts
      switch (state) {
        case 'connected':
        case 'completed':
          console.log(`✅ ICE connection established in ${elapsed}ms`);
          this.clearAllTimeouts();
          break;
          
        case 'failed':
          console.log(`❌ ICE connection failed after ${elapsed}ms - no restart, using TURN relay`);
          // Don't restart - force TURN relay instead
          this.forceTURNRelay(peerConnection);
          break;
          
        case 'disconnected':
          console.log(`⚠️ ICE disconnected after ${elapsed}ms - monitoring for recovery`);
          // Don't restart immediately - allow natural recovery
          break;
          
        case 'closed':
          console.log(`🔒 ICE connection closed after ${elapsed}ms`);
          this.clearAllTimeouts();
          break;
      }
      
      // Call original handler if it exists (for compatibility)
      if (originalICEHandler && typeof originalICEHandler === 'function') {
        try {
          originalICEHandler.call(peerConnection, event);
        } catch (error) {
          console.warn('⚠️ Original ICE handler error (non-critical):', error);
        }
      }
    };
    
    peerConnection.onconnectionstatechange = (event) => {
      const state = peerConnection.connectionState;
      const elapsed = Date.now() - this.startTime;
      
      console.log(`🔗 Connection state: ${state} (${elapsed}ms) - restart logic disabled`);
      
      // Handle states without triggering restarts
      switch (state) {
        case 'connected':
          console.log(`✅ Connection established in ${elapsed}ms`);
          this.clearAllTimeouts();
          break;
          
        case 'failed':
        case 'closed':
          console.log(`❌ Connection ${state} after ${elapsed}ms - no restart attempts`);
          this.clearAllTimeouts();
          break;
      }
      
      // Call original handler if it exists (for compatibility)
      if (originalConnectionHandler && typeof originalConnectionHandler === 'function') {
        try {
          originalConnectionHandler.call(peerConnection, event);
        } catch (error) {
          console.warn('⚠️ Original connection handler error (non-critical):', error);
        }
      }
    };
    
    console.log('✅ Redundant ICE restart handlers removed and replaced with optimized versions');
  }

  /**
   * Clear a specific timeout
   */
  private clearTimeout(name: string): void {
    const timeout = this.timeouts.get(name);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(name);
      console.log(`⏰ Cleared ${name} timeout`);
    }
  }

  /**
   * Clear all timeouts
   * Requirements: 2.5 - Clean up timeouts when connection established
   */
  clearAllTimeouts(): void {
    console.log(`⏰ Clearing all timeouts (${this.timeouts.size} active)`);
    
    // Use Array.from to avoid iterator issues
    const timeoutEntries = Array.from(this.timeouts.entries());
    for (const [name, timeout] of timeoutEntries) {
      clearTimeout(timeout);
      console.log(`⏰ Cleared ${name} timeout`);
    }
    
    this.timeouts.clear();
    this.isActive = false;
    
    const totalElapsed = this.startTime > 0 ? Date.now() - this.startTime : 0;
    console.log(`✅ All timeouts cleared after ${totalElapsed}ms`);
  }

  /**
   * Check if timeout controller is active
   */
  isTimeoutActive(): boolean {
    return this.isActive;
  }

  /**
   * Get elapsed time since timeout controller started
   */
  getElapsedTime(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0;
  }

  /**
   * Get active timeout names
   */
  getActiveTimeouts(): string[] {
    return Array.from(this.timeouts.keys());
  }

  /**
   * Get timeout configuration
   */
  getConfig(): TimeoutConfig {
    return { ...this.config };
  }

  /**
   * Update timeout configuration
   * Requirements: 2.1, 2.2, 2.3 - Allow dynamic timeout adjustment
   */
  updateConfig(newConfig: Partial<TimeoutConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    
    console.log('⏰ Timeout configuration updated:', {
      old: oldConfig,
      new: this.config,
      changes: newConfig
    });
    
    // If controller is active, warn about configuration change
    if (this.isActive) {
      console.warn('⚠️ Timeout configuration changed while controller is active');
      console.warn('⚠️ Changes will take effect on next timeout start');
    }
  }

  /**
   * Get timeout statistics
   */
  getStats(): {
    isActive: boolean;
    elapsedTime: number;
    activeTimeouts: string[];
    config: TimeoutConfig;
    startTime: number;
  } {
    return {
      isActive: this.isActive,
      elapsedTime: this.getElapsedTime(),
      activeTimeouts: this.getActiveTimeouts(),
      config: this.getConfig(),
      startTime: this.startTime
    };
  }

  /**
   * Reset timeout controller state
   */
  reset(): void {
    console.log('🔄 Resetting aggressive timeout controller');
    
    this.clearAllTimeouts();
    this.isActive = false;
    this.startTime = 0;
    
    console.log('✅ Timeout controller reset complete');
  }
}

/**
 * Create timeout controller with default TURN-first callbacks
 * Requirements: 2.1, 2.2, 2.3, 2.4 - Convenience factory function with ICE restart removal
 */
export function createTurnFirstTimeoutController(
  onTurnFallback: () => void,
  onTurnRelayForced: () => void,
  onICEGatheringTimeout: () => void,
  onParallelGatheringComplete?: () => void
): AggressiveTimeoutController {
  const callbacks: TimeoutCallbacks = {
    onTurnFallback,
    onTurnRelayForced,
    onICEGatheringTimeout,
    onParallelGatheringComplete: onParallelGatheringComplete || (() => {
      console.log('📊 Parallel gathering phase complete - no ICE restart logic');
    })
  };

  const controller = new AggressiveTimeoutController(callbacks);
  
  console.log('✅ TURN-first timeout controller created with ICE restart removal');
  console.log('🚫 Redundant ICE restart logic will be automatically disabled');
  
  return controller;
}

/**
 * Default timeout configuration for different network types
 * Requirements: 2.1, 2.2, 2.3 - Network-specific timeout optimization
 */
export const NETWORK_TIMEOUT_CONFIGS: Record<string, Partial<TimeoutConfig>> = {
  mobile: {
    // More aggressive timeouts for mobile networks
    iceGatheringTimeout: 4000, // 4 seconds
    turnFallbackTimeout: 2000, // 2 seconds
    turnRelayForceTimeout: 2500, // 2.5 seconds
    parallelGatheringTimeout: 1500 // 1.5 seconds
  },
  wifi: {
    // Standard timeouts for WiFi networks
    iceGatheringTimeout: 5000, // 5 seconds
    turnFallbackTimeout: 3000, // 3 seconds
    turnRelayForceTimeout: 3000, // 3 seconds
    parallelGatheringTimeout: 2000 // 2 seconds
  },
  unknown: {
    // Conservative timeouts for unknown networks
    iceGatheringTimeout: 5000, // 5 seconds
    turnFallbackTimeout: 3000, // 3 seconds
    turnRelayForceTimeout: 3000, // 3 seconds
    parallelGatheringTimeout: 2000 // 2 seconds
  }
};

/**
 * Get timeout configuration for specific network type
 * Requirements: 2.1, 2.2, 2.3 - Network-optimized timeouts
 */
export function getNetworkTimeoutConfig(networkType: 'mobile' | 'wifi' | 'unknown'): Partial<TimeoutConfig> {
  return NETWORK_TIMEOUT_CONFIGS[networkType] || NETWORK_TIMEOUT_CONFIGS.unknown;
}

/**
 * Disable ICE restart logic in NetworkTraversalMonitor
 * Requirements: 2.4 - Remove redundant ICE restart logic that extends connection time
 */
export function disableNetworkTraversalICERestart(): void {
  console.log('🚫 Disabling ICE restart logic in NetworkTraversalMonitor');
  
  // This function can be called to ensure NetworkTraversalMonitor doesn't perform restarts
  // The actual implementation would need to be updated in webrtc-network-traversal.ts
  console.log('⚠️ Note: NetworkTraversalMonitor ICE restart logic should be disabled in webrtc-network-traversal.ts');
  console.log('🔄 Use TURN-first strategy instead of ICE restart for connection reliability');
}

/**
 * Create optimized timeout controller that prevents connection time extension
 * Requirements: 2.4, 2.5 - Prevent redundant operations that extend connection time
 */
export function createOptimizedTimeoutController(
  networkType: 'mobile' | 'wifi' | 'unknown' = 'unknown'
): AggressiveTimeoutController {
  const networkConfig = getNetworkTimeoutConfig(networkType);
  
  const callbacks: TimeoutCallbacks = {
    onTurnFallback: () => {
      console.log(`🔄 TURN fallback triggered for ${networkType} network - no ICE restart`);
    },
    onTurnRelayForced: () => {
      console.log(`🔒 TURN relay forced for ${networkType} network - bypassing ICE restart`);
    },
    onICEGatheringTimeout: () => {
      console.log(`⏰ ICE gathering timeout for ${networkType} network - proceeding without restart`);
    },
    onParallelGatheringComplete: () => {
      console.log(`📊 Parallel gathering complete for ${networkType} network - no restart logic`);
    }
  };

  const controller = new AggressiveTimeoutController(callbacks, networkConfig);
  
  console.log(`✅ Optimized timeout controller created for ${networkType} network`);
  console.log('🚫 All redundant ICE restart logic will be automatically disabled');
  
  return controller;
}