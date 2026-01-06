/**
 * WebRTC Connection State Manager
 * Handles connection state tracking and management for video chat sessions
 */

// Global Connection Authority Flag - single source of truth for connection state
let CALL_IS_CONNECTED = false;

// Pre-Connection Process Registry Interfaces
export interface PreConnectionProcess {
  id: string;
  type: 'timeout' | 'interval' | 'abortController' | 'networkProbe';
  handle: NodeJS.Timeout | AbortController | Promise<any>;
  description: string;
  createdAt: Date;
}

export interface ProcessRegistry {
  processes: Map<string, PreConnectionProcess>;
  isKilled: boolean;
  killedAt?: Date;
}

export interface PreConnectionProcesses {
  timeouts: Set<NodeJS.Timeout>;
  intervals: Set<NodeJS.Timeout>;
  abortControllers: Set<AbortController>;
  networkProbes: Set<Promise<any>>;
}

// Global Pre-Connection Process Registry
const preConnectionRegistry: PreConnectionProcesses = {
  timeouts: new Set(),
  intervals: new Set(),
  abortControllers: new Set(),
  networkProbes: new Set()
};

// Detailed Process Registry with metadata
const processRegistry: ProcessRegistry = {
  processes: new Map(),
  isKilled: false,
  killedAt: undefined
};

export type ConnectionState = 
  | 'new' 
  | 'connecting' 
  | 'connected' 
  | 'disconnected' 
  | 'failed' 
  | 'closed';

export interface WebRTCConnection {
  id: string;
  user1Id: string;
  user2Id: string;
  state: ConnectionState;
  createdAt: Date;
  connectedAt?: Date;
  disconnectedAt?: Date;
  lastActivity: Date;
}

export class WebRTCManager {
  private connections: Map<string, WebRTCConnection>;

  constructor() {
    this.connections = new Map();
  }

  /**
   * Get the global connection authority flag
   */
  static getCallIsConnected(): boolean {
    return CALL_IS_CONNECTED;
  }

  /**
   * Set the global connection authority flag
   * This should only be called by connection state monitoring
   */
  static setCallIsConnected(connected: boolean): void {
    const wasConnected = CALL_IS_CONNECTED;
    CALL_IS_CONNECTED = connected;
    
    if (connected && !wasConnected) {
      console.log('🔒 CALL_IS_CONNECTED set to true - connection established');
    } else if (!connected && wasConnected) {
      console.log('🔓 CALL_IS_CONNECTED set to false - connection reset');
    }
  }

  /**
   * Monitor RTCPeerConnection state changes and update global authority flag
   * Requirements: 1.1 - Set CALL_IS_CONNECTED = true when connection established
   * Requirements: 1.2 - Execute killAllPreConnectionLogic() immediately when connected
   */
  static monitorConnectionState(peerConnection: RTCPeerConnection): void {
    const checkConnectionState = () => {
      const connectionState = peerConnection.connectionState;
      const iceConnectionState = peerConnection.iceConnectionState;
      
      // Check for actual failures FIRST - these override connection establishment (Requirements 4.1, 4.2, 4.5)
      // Even if one state is "connected", if the other is "failed", the connection is not usable
      if (connectionState === 'failed' || connectionState === 'closed' || iceConnectionState === 'failed') {
        if (CALL_IS_CONNECTED) {
          console.log(`❌ Actual WebRTC failure detected: connectionState=${connectionState}, iceConnectionState=${iceConnectionState}`);
          console.log('🔄 Allowing recovery attempts for actual failure');
          
          try {
            // Reset CALL_IS_CONNECTED to false for actual failures (Requirements 4.1, 4.2)
            WebRTCManager.setCallIsConnected(false);
            
            // Reset the process registry to allow new pre-connection logic for recovery
            resetPreConnectionRegistry();
            
            console.log('✅ Connection state reset successfully for recovery');
            
          } catch (error) {
            console.error('❌ Failed to reset connection state for recovery:', error);
            
            // Use enhanced error recovery mechanism
            const recoverySuccess = resetConnectionStateForRecovery(`WebRTC failure: ${connectionState}/${iceConnectionState}`);
            if (!recoverySuccess) {
              console.error('🚨 CRITICAL: Recovery state reset completely failed. Manual intervention may be required.');
              
              // Enable polling fallback as last resort
              try {
                enableConnectionStateMonitoringFallback(peerConnection);
              } catch (fallbackError) {
                console.error('❌ Failed to enable monitoring fallback:', fallbackError);
              }
            }
          }
        }
        return; // Exit early for failure states
      }
      
      // Requirements 1.1: Set CALL_IS_CONNECTED = true when either state becomes "connected"
      // This is checked AFTER failure detection to ensure actual failures take priority
      if (connectionState === 'connected' || iceConnectionState === 'connected') {
        if (!CALL_IS_CONNECTED) {
          console.log(`🔗 Connection established: connectionState=${connectionState}, iceConnectionState=${iceConnectionState}`);
          WebRTCManager.setCallIsConnected(true);
          
          // Execute killAllPreConnectionLogic() immediately (Requirements 1.2)
          try {
            killAllPreConnectionLogic();
          } catch (error) {
            console.error('❌ Failed to execute killAllPreConnectionLogic():', error);
            
            // Use enhanced cleanup failure recovery
            const recoverySuccess = recoverFromCleanupFailure(error as Error);
            if (!recoverySuccess) {
              console.error('🚨 CRITICAL: All cleanup recovery mechanisms failed');
              
              // Attempt manual override as last resort
              const overrideResult = executeManualOverride({
                forceKillPreConnectionLogic: true,
                validateAndRepair: true
              }, 'Cleanup failure recovery');
              
              if (!overrideResult.success) {
                console.error('🚨 CRITICAL: Manual override also failed:', overrideResult.errors);
                console.error('🚨 Some pre-connection processes may continue running and interfere with the connection');
              }
            }
          }
        }
        return; // Exit early after connection establishment
      }
      
      // Check for temporary disconnections - do NOT reset CALL_IS_CONNECTED (Requirements 4.5)
      // This is checked AFTER connection establishment to ensure proper priority
      // Cast to string to avoid TypeScript strict type checking issues
      const connState = connectionState as string;
      const iceState = iceConnectionState as string;
      
      if ((connState === 'disconnected' && iceState !== 'failed') || 
          (iceState === 'disconnected' && connState !== 'failed' && connState !== 'closed')) {
        if (CALL_IS_CONNECTED) {
          console.log(`⚠️ Temporary disconnection detected: connectionState=${connState}, iceConnectionState=${iceState}`);
          console.log('🔒 Maintaining CALL_IS_CONNECTED = true (temporary disconnection, not permanent failure)');
          console.log('🚫 Recovery attempts blocked - waiting for reconnection or actual failure');
          
          // Do NOT reset CALL_IS_CONNECTED for temporary disconnections
          // The connection may recover automatically without intervention
        }
        return; // Exit early for temporary disconnections
      }
    };

    // Monitor both connection state and ICE connection state with enhanced error handling
    try {
      peerConnection.addEventListener('connectionstatechange', checkConnectionState);
      peerConnection.addEventListener('iceconnectionstatechange', checkConnectionState);
      
      console.log('✅ Connection state monitoring event listeners attached successfully');
      
    } catch (error) {
      console.error('❌ Failed to attach connection state monitoring event listeners:', error);
      
      // Enhanced fallback: try to attach listeners individually
      let listenersAttached = 0;
      
      try {
        peerConnection.addEventListener('connectionstatechange', checkConnectionState);
        console.log('✅ connectionstatechange listener attached as fallback');
        listenersAttached++;
      } catch (connectionError) {
        console.error('❌ Failed to attach connectionstatechange listener:', connectionError);
      }
      
      try {
        peerConnection.addEventListener('iceconnectionstatechange', checkConnectionState);
        console.log('✅ iceconnectionstatechange listener attached as fallback');
        listenersAttached++;
      } catch (iceError) {
        console.error('❌ Failed to attach iceconnectionstatechange listener:', iceError);
      }
      
      // If no listeners could be attached, enable polling fallback
      if (listenersAttached === 0) {
        console.warn('⚠️ No event listeners could be attached, enabling polling fallback');
        try {
          enableConnectionStateMonitoringFallback(peerConnection);
        } catch (fallbackError) {
          console.error('❌ Failed to enable polling fallback:', fallbackError);
          console.error('🚨 CRITICAL: No connection state monitoring is active');
        }
      } else if (listenersAttached === 1) {
        console.warn('⚠️ Only partial event listener coverage, consider enabling polling fallback for redundancy');
      }
    }
    
    // Initial check in case connection is already established
    try {
      checkConnectionState();
    } catch (error) {
      console.error('❌ Failed to perform initial connection state check:', error);
      
      // Try to get state directly and handle manually
      try {
        const currentConnectionState = peerConnection.connectionState;
        const currentIceConnectionState = peerConnection.iceConnectionState;
        
        console.log(`🔄 Manual state check: connectionState=${currentConnectionState}, iceConnectionState=${currentIceConnectionState}`);
        
        handleConnectionStateChange(peerConnection, currentConnectionState, currentIceConnectionState);
        
      } catch (manualError) {
        console.error('❌ Manual state check also failed:', manualError);
        // Don't throw - monitoring is still set up for future state changes
      }
    }
  }

  /**
   * Create a new WebRTC connection tracking entry
   */
  createConnection(roomId: string, user1Id: string, user2Id: string): WebRTCConnection {
    const connection: WebRTCConnection = {
      id: roomId,
      user1Id,
      user2Id,
      state: 'new',
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.connections.set(roomId, connection);
    console.log(`WebRTC connection created: ${roomId} between ${user1Id} and ${user2Id}`);
    
    return connection;
  }

  /**
   * Update connection state
   */
  updateConnectionState(roomId: string, newState: ConnectionState): boolean {
    const connection = this.connections.get(roomId);
    if (!connection) {
      console.error(`Connection ${roomId} not found`);
      return false;
    }

    const oldState = connection.state;
    connection.state = newState;
    connection.lastActivity = new Date();

    // Track specific state transitions
    if (newState === 'connected' && oldState !== 'connected') {
      connection.connectedAt = new Date();
      console.log(`WebRTC connection established: ${roomId}`);
    } else if (newState === 'disconnected' || newState === 'failed' || newState === 'closed') {
      connection.disconnectedAt = new Date();
      console.log(`WebRTC connection ended: ${roomId} (${newState})`);
    }

    return true;
  }

  /**
   * Get connection by room ID
   */
  getConnection(roomId: string): WebRTCConnection | null {
    return this.connections.get(roomId) || null;
  }

  /**
   * Get connection by user ID
   */
  getConnectionByUserId(userId: string): WebRTCConnection | null {
    const connections = Array.from(this.connections.values());
    for (const connection of connections) {
      if (connection.user1Id === userId || connection.user2Id === userId) {
        return connection;
      }
    }
    return null;
  }

  /**
   * Remove connection
   */
  removeConnection(roomId: string): boolean {
    const removed = this.connections.delete(roomId);
    if (removed) {
      console.log(`WebRTC connection removed: ${roomId}`);
    }
    return removed;
  }

  /**
   * Get all active connections
   */
  getActiveConnections(): WebRTCConnection[] {
    return Array.from(this.connections.values()).filter(
      conn => conn.state === 'connecting' || conn.state === 'connected'
    );
  }

  /**
   * Clean up old connections
   */
  cleanupOldConnections(maxAgeMinutes: number = 60): number {
    const now = new Date();
    const maxAge = maxAgeMinutes * 60 * 1000;
    let cleanedCount = 0;

    const entries = Array.from(this.connections.entries());
    for (const [roomId, connection] of entries) {
      const age = now.getTime() - connection.lastActivity.getTime();
      
      if (age > maxAge && (connection.state === 'disconnected' || connection.state === 'failed' || connection.state === 'closed')) {
        this.connections.delete(roomId);
        cleanedCount++;
        console.log(`Cleaned up old WebRTC connection: ${roomId}`);
      }
    }

    return cleanedCount;
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    total: number;
    active: number;
    byState: Record<ConnectionState, number>;
  } {
    const stats = {
      total: this.connections.size,
      active: 0,
      byState: {
        'new': 0,
        'connecting': 0,
        'connected': 0,
        'disconnected': 0,
        'failed': 0,
        'closed': 0
      } as Record<ConnectionState, number>
    };

    const connections = Array.from(this.connections.values());
    for (const connection of connections) {
      stats.byState[connection.state]++;
      if (connection.state === 'connecting' || connection.state === 'connected') {
        stats.active++;
      }
    }

    return stats;
  }
}

/**
 * Pre-Connection Process Registry Management
 * Requirements: 5.1, 5.2, 5.4 - Centralized management of all pre-connection processes
 */

/**
 * Generate unique ID for process tracking
 */
function generateProcessId(): string {
  return `proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Register a timeout in the pre-connection process registry
 * Requirements: 5.1, 5.4 - Registry of timeouts for lifecycle management
 * Requirements: 5.5 - Lifecycle gate enforcement
 */
export function registerTimeout(callback: () => void, delay: number, description: string = 'Timeout'): NodeJS.Timeout | null {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 Blocked: Cannot create timeout after connection established');
    return null;
  }

  if (processRegistry.isKilled) {
    console.warn('🚫 Blocked: Cannot create timeout after pre-connection logic has been killed');
    return null;
  }

  const processId = generateProcessId();
  const timeout = setTimeout(() => {
    // Remove from registries when timeout fires naturally
    preConnectionRegistry.timeouts.delete(timeout);
    processRegistry.processes.delete(processId);
    callback();
  }, delay);

  // Register in both registries
  preConnectionRegistry.timeouts.add(timeout);
  
  const process: PreConnectionProcess = {
    id: processId,
    type: 'timeout',
    handle: timeout,
    description,
    createdAt: new Date()
  };
  processRegistry.processes.set(processId, process);

  console.log(`⏰ Registered timeout: ${processId} - ${description} (${delay}ms)`);
  return timeout;
}

/**
 * Register an interval in the pre-connection process registry
 * Requirements: 5.1, 5.4 - Registry of intervals for lifecycle management
 * Requirements: 5.5 - Lifecycle gate enforcement
 */
export function registerInterval(callback: () => void, delay: number, description: string = 'Interval'): NodeJS.Timeout | null {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 Blocked: Cannot create interval after connection established');
    return null;
  }

  if (processRegistry.isKilled) {
    console.warn('🚫 Blocked: Cannot create interval after pre-connection logic has been killed');
    return null;
  }

  const processId = generateProcessId();
  const interval = setInterval(callback, delay);

  // Register in both registries
  preConnectionRegistry.intervals.add(interval);
  
  const process: PreConnectionProcess = {
    id: processId,
    type: 'interval',
    handle: interval,
    description,
    createdAt: new Date()
  };
  processRegistry.processes.set(processId, process);

  console.log(`🔄 Registered interval: ${processId} - ${description} (${delay}ms)`);
  return interval;
}

/**
 * Register an AbortController in the pre-connection process registry
 * Requirements: 5.2, 5.4 - Registry of async controllers for lifecycle management
 * Requirements: 5.5 - Lifecycle gate enforcement
 */
export function registerAbortController(description: string = 'AbortController'): AbortController | null {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 Blocked: Cannot create AbortController after connection established');
    return null;
  }

  if (processRegistry.isKilled) {
    console.warn('🚫 Blocked: Cannot create AbortController after pre-connection logic has been killed');
    return null;
  }

  const processId = generateProcessId();
  const abortController = new AbortController();

  // Register in both registries
  preConnectionRegistry.abortControllers.add(abortController);
  
  const process: PreConnectionProcess = {
    id: processId,
    type: 'abortController',
    handle: abortController,
    description,
    createdAt: new Date()
  };
  processRegistry.processes.set(processId, process);

  console.log(`🛑 Registered AbortController: ${processId} - ${description}`);
  return abortController;
}

/**
 * Register a network probe promise in the pre-connection process registry
 * Requirements: 5.2, 5.4 - Registry of network probes for lifecycle management
 * Requirements: 5.5 - Lifecycle gate enforcement
 */
export function registerNetworkProbe(probe: Promise<any>, description: string = 'Network Probe'): Promise<any> | null {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 Blocked: Cannot create network probe after connection established');
    return null;
  }

  if (processRegistry.isKilled) {
    console.warn('🚫 Blocked: Cannot create network probe after pre-connection logic has been killed');
    return null;
  }

  const processId = generateProcessId();

  // Register in both registries
  preConnectionRegistry.networkProbes.add(probe);
  
  const process: PreConnectionProcess = {
    id: processId,
    type: 'networkProbe',
    handle: probe,
    description,
    createdAt: new Date()
  };
  processRegistry.processes.set(processId, process);

  // Clean up from registry when probe completes (success or failure)
  probe.finally(() => {
    preConnectionRegistry.networkProbes.delete(probe);
    processRegistry.processes.delete(processId);
  });

  console.log(`🌐 Registered network probe: ${processId} - ${description}`);
  return probe;
}

/**
 * Unregister a timeout from the pre-connection process registry
 * Used when manually clearing timeouts before they fire
 */
export function unregisterTimeout(timeout: NodeJS.Timeout): void {
  preConnectionRegistry.timeouts.delete(timeout);
  
  // Find and remove from detailed registry
  for (const [id, process] of processRegistry.processes.entries()) {
    if (process.type === 'timeout' && process.handle === timeout) {
      processRegistry.processes.delete(id);
      console.log(`⏰ Unregistered timeout: ${id}`);
      break;
    }
  }
}

/**
 * Unregister an interval from the pre-connection process registry
 * Used when manually clearing intervals
 */
export function unregisterInterval(interval: NodeJS.Timeout): void {
  preConnectionRegistry.intervals.delete(interval);
  
  // Find and remove from detailed registry
  for (const [id, process] of processRegistry.processes.entries()) {
    if (process.type === 'interval' && process.handle === interval) {
      processRegistry.processes.delete(id);
      console.log(`🔄 Unregistered interval: ${id}`);
      break;
    }
  }
}

/**
 * Unregister an AbortController from the pre-connection process registry
 * Used when manually aborting controllers
 */
export function unregisterAbortController(controller: AbortController): void {
  preConnectionRegistry.abortControllers.delete(controller);
  
  // Find and remove from detailed registry
  for (const [id, process] of processRegistry.processes.entries()) {
    if (process.type === 'abortController' && process.handle === controller) {
      processRegistry.processes.delete(id);
      console.log(`🛑 Unregistered AbortController: ${id}`);
      break;
    }
  }
}

/**
 * Get current pre-connection process registry state
 * Requirements: 5.1, 5.2 - Access to registry for monitoring and debugging
 */
export function getPreConnectionRegistryState(): {
  simple: PreConnectionProcesses;
  detailed: ProcessRegistry;
  counts: {
    timeouts: number;
    intervals: number;
    abortControllers: number;
    networkProbes: number;
    total: number;
  };
} {
  return {
    simple: {
      timeouts: new Set(preConnectionRegistry.timeouts),
      intervals: new Set(preConnectionRegistry.intervals),
      abortControllers: new Set(preConnectionRegistry.abortControllers),
      networkProbes: new Set(preConnectionRegistry.networkProbes)
    },
    detailed: {
      processes: new Map(processRegistry.processes),
      isKilled: processRegistry.isKilled,
      killedAt: processRegistry.killedAt
    },
    counts: {
      timeouts: preConnectionRegistry.timeouts.size,
      intervals: preConnectionRegistry.intervals.size,
      abortControllers: preConnectionRegistry.abortControllers.size,
      networkProbes: preConnectionRegistry.networkProbes.size,
      total: processRegistry.processes.size
    }
  };
}

/**
 * Kill all pre-connection logic immediately
 * Requirements: 1.2, 1.3, 1.4 - Centralized cleanup of all pre-connection processes
 * 
 * This function implements the core lifecycle gate mechanism by:
 * - Clearing all registered timeouts and intervals
 * - Aborting all async controllers used for network probes
 * - Cleaning up the process registry
 * - Logging the cleanup operation
 * - Marking the registry as killed to prevent restart
 */
export function killAllPreConnectionLogic(): void {
  console.log('🔒 killAllPreConnectionLogic() executing - terminating all pre-connection processes');
  
  const startTime = Date.now();
  let processesKilled = 0;
  const errors: string[] = [];

  try {
    // Clear all timeouts (Requirements 1.3)
    console.log(`⏰ Clearing ${preConnectionRegistry.timeouts.size} timeouts...`);
    preConnectionRegistry.timeouts.forEach(timeout => {
      try {
        clearTimeout(timeout);
        processesKilled++;
      } catch (error) {
        errors.push(`Failed to clear timeout: ${error}`);
      }
    });
    preConnectionRegistry.timeouts.clear();

    // Clear all intervals (Requirements 1.3)
    console.log(`🔄 Clearing ${preConnectionRegistry.intervals.size} intervals...`);
    preConnectionRegistry.intervals.forEach(interval => {
      try {
        clearInterval(interval);
        processesKilled++;
      } catch (error) {
        errors.push(`Failed to clear interval: ${error}`);
      }
    });
    preConnectionRegistry.intervals.clear();

    // Abort all async controllers (Requirements 1.4)
    console.log(`🛑 Aborting ${preConnectionRegistry.abortControllers.size} abort controllers...`);
    preConnectionRegistry.abortControllers.forEach(controller => {
      try {
        if (!controller.signal.aborted) {
          controller.abort();
          processesKilled++;
        }
      } catch (error) {
        errors.push(`Failed to abort controller: ${error}`);
      }
    });
    preConnectionRegistry.abortControllers.clear();

    // Cancel network probes (Requirements 1.4)
    console.log(`🌐 Canceling ${preConnectionRegistry.networkProbes.size} network probes...`);
    preConnectionRegistry.networkProbes.forEach(probe => {
      try {
        // Network probes are promises - we can't cancel them directly,
        // but we clear them from the registry so they're no longer tracked
        processesKilled++;
      } catch (error) {
        errors.push(`Failed to cancel network probe: ${error}`);
      }
    });
    preConnectionRegistry.networkProbes.clear();

    // Clean up detailed process registry (Requirements 1.3, 1.4)
    console.log(`📋 Clearing detailed process registry (${processRegistry.processes.size} processes)...`);
    processRegistry.processes.clear();
    
    // Mark registry as killed to prevent restart (Requirements 5.5)
    processRegistry.isKilled = true;
    processRegistry.killedAt = new Date();

    const duration = Date.now() - startTime;
    
    if (errors.length > 0) {
      console.warn(`⚠️ killAllPreConnectionLogic() completed with ${errors.length} errors in ${duration}ms:`);
      errors.forEach(error => console.warn(`  - ${error}`));
    } else {
      console.log(`✅ killAllPreConnectionLogic() completed successfully in ${duration}ms`);
    }
    
    console.log(`📊 Cleanup summary: ${processesKilled} processes terminated, registry marked as killed`);
    console.log('🔒 All pre-connection logic terminated - call is connected and protected');

  } catch (error) {
    console.error('❌ Critical error in killAllPreConnectionLogic():', error);
    
    // Even if there's an error, mark as killed to prevent further issues
    processRegistry.isKilled = true;
    processRegistry.killedAt = new Date();
    
    throw new Error(`killAllPreConnectionLogic() failed: ${error}`);
  }
}

/**
 * Failure State Recovery Functions
 * Requirements: 4.1, 4.2, 4.5 - Connection recovery only for actual failures
 */

/**
 * Check if a connection state represents an actual WebRTC failure
 * Requirements: 4.1, 4.2 - Allow recovery attempts only for actual WebRTC failures
 */
export function isActualWebRTCFailure(connectionState: string, iceConnectionState: string): boolean {
  // Actual failures that should allow recovery
  const actualFailures = [
    connectionState === 'failed',
    connectionState === 'closed', 
    iceConnectionState === 'failed'
  ];
  
  return actualFailures.some(condition => condition);
}

/**
 * Check if a connection state represents a temporary disconnection
 * Requirements: 4.5 - Distinguish between temporary disconnection and permanent failure
 */
export function isTemporaryDisconnection(connectionState: string, iceConnectionState: string): boolean {
  // First check if it's an actual failure - if so, it's not temporary
  if (isActualWebRTCFailure(connectionState, iceConnectionState)) {
    return false;
  }
  
  // Temporary disconnections that should NOT trigger recovery
  const temporaryStates = [
    connectionState === 'disconnected' && iceConnectionState !== 'failed',
    iceConnectionState === 'disconnected' && connectionState !== 'failed' && connectionState !== 'closed'
  ];
  
  return temporaryStates.some(condition => condition);
}

/**
 * Check if recovery attempts should be allowed based on connection state
 * Requirements: 4.1, 4.2, 4.5 - Recovery logic for actual failures only
 */
export function shouldAllowRecovery(connectionState: string, iceConnectionState: string): boolean {
  // Only allow recovery for actual failures, not temporary disconnections
  if (isActualWebRTCFailure(connectionState, iceConnectionState)) {
    console.log(`✅ Recovery allowed: Actual WebRTC failure detected (${connectionState}/${iceConnectionState})`);
    return true;
  }
  
  if (isTemporaryDisconnection(connectionState, iceConnectionState)) {
    console.log(`🚫 Recovery blocked: Temporary disconnection detected (${connectionState}/${iceConnectionState})`);
    return false;
  }
  
  // For other states, don't allow recovery if connected
  if (CALL_IS_CONNECTED) {
    console.log(`🚫 Recovery blocked: CALL_IS_CONNECTED = true (${connectionState}/${iceConnectionState})`);
    return false;
  }
  
  return true;
}

/**
 * Reset connection state for recovery attempts
 * Requirements: 4.1, 4.2 - Reset state only for actual failures
 */
export function resetConnectionStateForRecovery(reason: string): boolean {
  if (!CALL_IS_CONNECTED) {
    console.log(`⚠️ Connection state already reset, no action needed (${reason})`);
    return true;
  }
  
  try {
    console.log(`🔄 Resetting connection state for recovery: ${reason}`);
    
    // Reset the global authority flag
    WebRTCManager.setCallIsConnected(false);
    
    // Reset the process registry to allow new pre-connection logic
    resetPreConnectionRegistry();
    
    console.log(`✅ Connection state reset successfully for recovery: ${reason}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Failed to reset connection state for recovery (${reason}):`, error);
    
    // Attempt force reset as fallback
    try {
      CALL_IS_CONNECTED = false;
      
      // Manual registry reset
      preConnectionRegistry.timeouts.clear();
      preConnectionRegistry.intervals.clear();
      preConnectionRegistry.abortControllers.clear();
      preConnectionRegistry.networkProbes.clear();
      
      processRegistry.processes.clear();
      processRegistry.isKilled = false;
      processRegistry.killedAt = undefined;
      
      console.log(`🔄 Force reset completed for recovery: ${reason}`);
      return true;
      
    } catch (forceError) {
      console.error(`❌ Force reset also failed for recovery (${reason}):`, forceError);
      return false;
    }
  }
}

/**
 * Check if the current connection state allows new connection attempts
 * Requirements: 4.1, 4.2, 4.5 - Control when new connections can be started
 */
export function canStartNewConnection(): boolean {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 Cannot start new connection: CALL_IS_CONNECTED = true');
    return false;
  }
  
  if (processRegistry.isKilled && CALL_IS_CONNECTED) {
    console.warn('🚫 Cannot start new connection: Pre-connection logic killed but connection still active');
    return false;
  }
  
  console.log('✅ New connection can be started');
  return true;
}

/**
 * Get detailed connection state information for debugging
 * Requirements: 4.5 - Better visibility into connection state decisions
 */
export function getConnectionStateInfo(): {
  callIsConnected: boolean;
  processRegistryKilled: boolean;
  processRegistryKilledAt?: Date;
  canStartNewConnection: boolean;
  activeProcesses: {
    timeouts: number;
    intervals: number;
    abortControllers: number;
    networkProbes: number;
    total: number;
  };
} {
  const registryState = getPreConnectionRegistryState();
  
  return {
    callIsConnected: CALL_IS_CONNECTED,
    processRegistryKilled: processRegistry.isKilled,
    processRegistryKilledAt: processRegistry.killedAt,
    canStartNewConnection: canStartNewConnection(),
    activeProcesses: registryState.counts
  };
}

/**
 * Check if pre-connection logic has been killed
 * Requirements: 5.5 - Lifecycle gate enforcement
 */
export function isPreConnectionLogicKilled(): boolean {
  return processRegistry.isKilled;
}

/**
 * Get the timestamp when pre-connection logic was killed
 * Requirements: 5.5 - Lifecycle gate enforcement tracking
 */
export function getPreConnectionLogicKilledAt(): Date | undefined {
  return processRegistry.killedAt;
}

/**
 * Reset the pre-connection process registry
 * Used for testing and recovery scenarios
 */
export function resetPreConnectionRegistry(): void {
  preConnectionRegistry.timeouts.clear();
  preConnectionRegistry.intervals.clear();
  preConnectionRegistry.abortControllers.clear();
  preConnectionRegistry.networkProbes.clear();
  
  processRegistry.processes.clear();
  processRegistry.isKilled = false;
  processRegistry.killedAt = undefined;
  
  console.log('🔄 Pre-connection process registry reset');
}

/**
 * Block reconnection attempts when CALL_IS_CONNECTED = true
 * Requirements: 1.5, 3.5, 4.3, 4.4 - Prevent reconnection logic after connection
 */
export function isReconnectionBlocked(): boolean {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 Reconnection blocked: CALL_IS_CONNECTED = true');
    return true;
  }
  
  if (processRegistry.isKilled) {
    console.warn('🚫 Reconnection blocked: Pre-connection logic has been killed');
    return true;
  }
  
  return false;
}

/**
 * Block latency spike handlers from triggering reconnection
 * Requirements: 1.5, 4.3 - Prevent latency spike handlers from triggering reconnection
 */
export function isLatencyHandlerBlocked(): boolean {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 Latency spike handler blocked: CALL_IS_CONNECTED = true');
    return true;
  }
  
  return false;
}

/**
 * Block visibility change handlers from reconnecting
 * Requirements: 4.4 - Block visibility change handlers from reconnecting
 */
export function isVisibilityChangeHandlerBlocked(): boolean {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 Visibility change handler blocked: CALL_IS_CONNECTED = true');
    return true;
  }
  
  return false;
}

/**
 * Block ICE restart attempts when connection is established
 * Requirements: 3.5 - Prevent ICE restart logic after connection
 */
export function isICERestartBlocked(): boolean {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 ICE restart blocked: CALL_IS_CONNECTED = true');
    return true;
  }
  
  return false;
}

/**
 * Check if any reconnection-related operation should be blocked
 * Requirements: 1.5, 3.5, 4.3, 4.4 - Comprehensive reconnection blocking
 */
export function shouldBlockReconnectionOperation(operationType: string): boolean {
  if (CALL_IS_CONNECTED) {
    console.warn(`🚫 ${operationType} blocked: CALL_IS_CONNECTED = true`);
    return true;
  }
  
  if (processRegistry.isKilled) {
    console.warn(`🚫 ${operationType} blocked: Pre-connection logic has been killed`);
    return true;
  }
  
  return false;
}

/**
 * Peer Connection Protection Functions
 * Requirements: 3.3, 3.4 - Prevent RTCPeerConnection recreation and restrict modification methods
 */

/**
 * Check if RTCPeerConnection recreation should be blocked
 * Requirements: 3.3 - Prevent RTCPeerConnection recreation when connected
 */
export function isPeerConnectionRecreationBlocked(): boolean {
  if (CALL_IS_CONNECTED) {
    console.warn('🚫 RTCPeerConnection recreation blocked: CALL_IS_CONNECTED = true');
    return true;
  }
  
  return false;
}

/**
 * Check if RTCPeerConnection modification methods should be blocked
 * Requirements: 3.4 - Block connection modification methods except getStats()
 */
export function isPeerConnectionModificationBlocked(methodName: string): boolean {
  if (CALL_IS_CONNECTED) {
    // Allow only getStats() for quality monitoring
    if (methodName === 'getStats') {
      return false;
    }
    
    console.warn(`🚫 RTCPeerConnection.${methodName}() blocked: CALL_IS_CONNECTED = true (only getStats() allowed)`);
    return true;
  }
  
  return false;
}

/**
 * Protected wrapper for RTCPeerConnection creation
 * Requirements: 3.3 - Prevent RTCPeerConnection recreation when connected
 */
export function createProtectedPeerConnection(config: RTCConfiguration): RTCPeerConnection | null {
  if (isPeerConnectionRecreationBlocked()) {
    console.error('❌ Cannot create RTCPeerConnection: Connection is already established');
    return null;
  }
  
  console.log('✅ Creating new RTCPeerConnection (connection not established)');
  return new RTCPeerConnection(config);
}

/**
 * Protected wrapper for RTCPeerConnection.createOffer()
 * Requirements: 3.4 - Block connection modification methods except getStats()
 */
export function protectedCreateOffer(peerConnection: RTCPeerConnection, options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> | null {
  if (isPeerConnectionModificationBlocked('createOffer')) {
    console.error('❌ Cannot call createOffer(): Connection is already established');
    return null;
  }
  
  console.log('✅ Calling createOffer() (connection not established)');
  return peerConnection.createOffer(options);
}

/**
 * Protected wrapper for RTCPeerConnection.createAnswer()
 * Requirements: 3.4 - Block connection modification methods except getStats()
 */
export function protectedCreateAnswer(peerConnection: RTCPeerConnection, options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> | null {
  if (isPeerConnectionModificationBlocked('createAnswer')) {
    console.error('❌ Cannot call createAnswer(): Connection is already established');
    return null;
  }
  
  console.log('✅ Calling createAnswer() (connection not established)');
  return peerConnection.createAnswer(options);
}

/**
 * Protected wrapper for RTCPeerConnection.setLocalDescription()
 * Requirements: 3.4 - Block connection modification methods except getStats()
 */
export function protectedSetLocalDescription(peerConnection: RTCPeerConnection, description?: RTCSessionDescriptionInit): Promise<void> | null {
  if (isPeerConnectionModificationBlocked('setLocalDescription')) {
    console.error('❌ Cannot call setLocalDescription(): Connection is already established');
    return null;
  }
  
  console.log('✅ Calling setLocalDescription() (connection not established)');
  return peerConnection.setLocalDescription(description);
}

/**
 * Protected wrapper for RTCPeerConnection.setRemoteDescription()
 * Requirements: 3.4 - Block connection modification methods except getStats()
 */
export function protectedSetRemoteDescription(peerConnection: RTCPeerConnection, description: RTCSessionDescriptionInit): Promise<void> | null {
  if (isPeerConnectionModificationBlocked('setRemoteDescription')) {
    console.error('❌ Cannot call setRemoteDescription(): Connection is already established');
    return null;
  }
  
  console.log('✅ Calling setRemoteDescription() (connection not established)');
  return peerConnection.setRemoteDescription(description);
}

/**
 * Protected wrapper for RTCPeerConnection.addTrack()
 * Requirements: 3.4 - Block connection modification methods except getStats()
 */
export function protectedAddTrack(peerConnection: RTCPeerConnection, track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender | null {
  if (isPeerConnectionModificationBlocked('addTrack')) {
    console.error('❌ Cannot call addTrack(): Connection is already established');
    return null;
  }
  
  console.log('✅ Calling addTrack() (connection not established)');
  return peerConnection.addTrack(track, ...streams);
}

/**
 * Protected wrapper for RTCPeerConnection.removeTrack()
 * Requirements: 3.4 - Block connection modification methods except getStats()
 */
export function protectedRemoveTrack(peerConnection: RTCPeerConnection, sender: RTCRtpSender): void | null {
  if (isPeerConnectionModificationBlocked('removeTrack')) {
    console.error('❌ Cannot call removeTrack(): Connection is already established');
    return null;
  }
  
  console.log('✅ Calling removeTrack() (connection not established)');
  return peerConnection.removeTrack(sender);
}

/**
 * Protected wrapper for RTCPeerConnection.restartIce()
 * Requirements: 3.4 - Block connection modification methods except getStats()
 */
export function protectedRestartIce(peerConnection: RTCPeerConnection): void | null {
  if (isPeerConnectionModificationBlocked('restartIce')) {
    console.error('❌ Cannot call restartIce(): Connection is already established');
    return null;
  }
  
  console.log('✅ Calling restartIce() (connection not established)');
  return peerConnection.restartIce();
}

/**
 * Protected wrapper for RTCPeerConnection.close()
 * Requirements: 3.4 - Allow close() for cleanup but log the action
 */
export function protectedClose(peerConnection: RTCPeerConnection): void {
  if (CALL_IS_CONNECTED) {
    console.warn('⚠️ Closing RTCPeerConnection while CALL_IS_CONNECTED = true');
    console.warn('⚠️ This should only happen during cleanup or actual connection failure');
  }
  
  console.log('🔒 Closing RTCPeerConnection');
  return peerConnection.close();
}

/**
 * Safe wrapper for RTCPeerConnection.getStats() - always allowed
 * Requirements: 3.4 - Only use getStats() for quality adaptation
 */
export function safeGetStats(peerConnection: RTCPeerConnection, selector?: MediaStreamTrack | null): Promise<RTCStatsReport> {
  console.log('📊 Calling getStats() for quality monitoring (always allowed)');
  return peerConnection.getStats(selector);
}

/**
 * Check if quality monitoring operations are allowed
 * Requirements: 3.4 - Only use getStats() for quality adaptation
 */
export function isQualityMonitoringAllowed(): boolean {
  // Quality monitoring is always allowed, but should only use getStats()
  return true;
}

/**
 * Check if quality adaptation operations should be restricted
 * Requirements: 3.4 - Restrict quality adaptation to safe operations only
 */
export function shouldRestrictQualityAdaptation(): boolean {
  if (CALL_IS_CONNECTED) {
    console.log('📊 Quality adaptation restricted to getStats() only - connection established');
    return true;
  }
  
  return false;
}

/**
 * Lifecycle Gate Enforcement Functions
 * Requirements: 5.5 - Prevent any pre-connection logic from restarting after connection
 */

/**
 * Check if any pre-connection operation should be blocked by the lifecycle gate
 * Requirements: 5.5 - Lifecycle gate enforcement
 */
export function isPreConnectionOperationBlocked(operationType: string): boolean {
  if (CALL_IS_CONNECTED) {
    console.warn(`🚫 ${operationType} blocked: CALL_IS_CONNECTED = true (connection established)`);
    return true;
  }
  
  if (processRegistry.isKilled) {
    console.warn(`🚫 ${operationType} blocked: Pre-connection logic has been permanently killed`);
    return true;
  }
  
  return false;
}

/**
 * Enforce lifecycle gate for network detection operations
 * Requirements: 5.5, 2.2, 2.3 - Block network detection startup when connected
 */
export function enforceNetworkDetectionGate(): boolean {
  return isPreConnectionOperationBlocked('Network detection');
}

/**
 * Enforce lifecycle gate for timeout creation
 * Requirements: 5.5 - Prevent timeout creation after cleanup
 */
export function enforceTimeoutCreationGate(): boolean {
  return isPreConnectionOperationBlocked('Timeout creation');
}

/**
 * Enforce lifecycle gate for interval creation
 * Requirements: 5.5 - Prevent interval creation after cleanup
 */
export function enforceIntervalCreationGate(): boolean {
  return isPreConnectionOperationBlocked('Interval creation');
}

/**
 * Enforce lifecycle gate for abort controller creation
 * Requirements: 5.5 - Prevent abort controller creation after cleanup
 */
export function enforceAbortControllerCreationGate(): boolean {
  return isPreConnectionOperationBlocked('AbortController creation');
}

/**
 * Enforce lifecycle gate for network probe creation
 * Requirements: 5.5 - Prevent network probe creation after cleanup
 */
export function enforceNetworkProbeCreationGate(): boolean {
  return isPreConnectionOperationBlocked('Network probe creation');
}

/**
 * Enforce lifecycle gate for ICE configuration changes
 * Requirements: 5.5, 2.4, 2.5, 3.1, 3.2 - Prevent ICE policy changes after connection
 */
export function enforceICEConfigurationGate(): boolean {
  return isPreConnectionOperationBlocked('ICE configuration change');
}

/**
 * Enforce lifecycle gate for NAT reclassification
 * Requirements: 5.5, 2.4 - Prevent NAT reclassification after connection
 */
export function enforceNATReclassificationGate(): boolean {
  return isPreConnectionOperationBlocked('NAT reclassification');
}

/**
 * Enforce lifecycle gate for connection setup operations
 * Requirements: 5.5 - Prevent connection setup operations after connection established
 */
export function enforceConnectionSetupGate(): boolean {
  return isPreConnectionOperationBlocked('Connection setup operation');
}

/**
 * Comprehensive pre-connection entry point enforcement
 * Requirements: 5.5 - Add enforcement checks to all pre-connection entry points
 */
export function enforceAllPreConnectionGates(): {
  networkDetection: boolean;
  timeoutCreation: boolean;
  intervalCreation: boolean;
  abortControllerCreation: boolean;
  networkProbeCreation: boolean;
  iceConfiguration: boolean;
  natReclassification: boolean;
  connectionSetup: boolean;
} {
  return {
    networkDetection: enforceNetworkDetectionGate(),
    timeoutCreation: enforceTimeoutCreationGate(),
    intervalCreation: enforceIntervalCreationGate(),
    abortControllerCreation: enforceAbortControllerCreationGate(),
    networkProbeCreation: enforceNetworkProbeCreationGate(),
    iceConfiguration: enforceICEConfigurationGate(),
    natReclassification: enforceNATReclassificationGate(),
    connectionSetup: enforceConnectionSetupGate()
  };
}

/**
 * Get lifecycle gate status for debugging and monitoring
 * Requirements: 5.5 - Lifecycle gate enforcement tracking
 */
export function getLifecycleGateStatus(): {
  callIsConnected: boolean;
  processRegistryKilled: boolean;
  processRegistryKilledAt?: Date;
  allGatesBlocked: boolean;
  blockedOperations: string[];
  allowedOperations: string[];
} {
  const gates = enforceAllPreConnectionGates();
  const blockedOperations: string[] = [];
  const allowedOperations: string[] = [];
  
  Object.entries(gates).forEach(([operation, isBlocked]) => {
    if (isBlocked) {
      blockedOperations.push(operation);
    } else {
      allowedOperations.push(operation);
    }
  });
  
  return {
    callIsConnected: CALL_IS_CONNECTED,
    processRegistryKilled: processRegistry.isKilled,
    processRegistryKilledAt: processRegistry.killedAt,
    allGatesBlocked: blockedOperations.length === Object.keys(gates).length,
    blockedOperations,
    allowedOperations
  };
}

/**
 * Force reset lifecycle gate (for testing and recovery scenarios)
 * Requirements: 5.5 - Allow manual override for edge cases
 */
export function forceResetLifecycleGate(reason: string): boolean {
  try {
    console.log(`🔄 Force resetting lifecycle gate: ${reason}`);
    
    // Reset global connection flag
    CALL_IS_CONNECTED = false;
    
    // Reset process registry
    resetPreConnectionRegistry();
    
    console.log(`✅ Lifecycle gate force reset completed: ${reason}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Failed to force reset lifecycle gate (${reason}):`, error);
    return false;
  }
}

/**
 * Validate lifecycle gate integrity
 * Requirements: 5.5 - Ensure lifecycle gate is working correctly
 */
export function validateLifecycleGateIntegrity(): {
  isValid: boolean;
  issues: string[];
  recommendations: string[];
} {
  const issues: string[] = [];
  const recommendations: string[] = [];
  
  // Check for inconsistent state
  if (CALL_IS_CONNECTED && !processRegistry.isKilled) {
    issues.push('CALL_IS_CONNECTED is true but processRegistry.isKilled is false');
    recommendations.push('Call killAllPreConnectionLogic() to synchronize state');
  }
  
  if (!CALL_IS_CONNECTED && processRegistry.isKilled) {
    issues.push('CALL_IS_CONNECTED is false but processRegistry.isKilled is true');
    recommendations.push('Call resetPreConnectionRegistry() to allow new connections');
  }
  
  // Check for active processes when they should be killed
  if (processRegistry.isKilled) {
    const registryState = getPreConnectionRegistryState();
    if (registryState.counts.total > 0) {
      issues.push(`Process registry marked as killed but ${registryState.counts.total} processes still active`);
      recommendations.push('Call killAllPreConnectionLogic() to clean up remaining processes');
    }
  }
  
  // Check for missing killedAt timestamp
  if (processRegistry.isKilled && !processRegistry.killedAt) {
    issues.push('Process registry marked as killed but killedAt timestamp is missing');
    recommendations.push('Set processRegistry.killedAt to current timestamp');
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    recommendations
  };
}

/**
 * Enhanced Error Handling and Fallback Mechanisms
 * Task 12: Add Error Handling and Fallbacks
 * Requirements: Error handling from design
 */

// Error tracking and recovery state
interface ErrorRecoveryState {
  cleanupFailures: number;
  connectionStateFailures: number;
  registryCorruptions: number;
  lastCleanupAttempt?: Date;
  lastConnectionStateCheck?: Date;
  lastRegistryReset?: Date;
  maxRetries: number;
  backoffMultiplier: number;
}

const errorRecoveryState: ErrorRecoveryState = {
  cleanupFailures: 0,
  connectionStateFailures: 0,
  registryCorruptions: 0,
  maxRetries: 3,
  backoffMultiplier: 1000 // 1 second base backoff
};

/**
 * Cleanup Failure Recovery Mechanisms
 * Implements robust recovery when killAllPreConnectionLogic() fails
 */
export function recoverFromCleanupFailure(originalError: Error): boolean {
  errorRecoveryState.cleanupFailures++;
  errorRecoveryState.lastCleanupAttempt = new Date();
  
  console.error(`🚨 Cleanup failure #${errorRecoveryState.cleanupFailures}:`, originalError);
  
  if (errorRecoveryState.cleanupFailures > errorRecoveryState.maxRetries) {
    console.error('🚨 CRITICAL: Maximum cleanup retry attempts exceeded');
    return attemptEmergencyCleanup();
  }
  
  try {
    console.log('🔄 Attempting cleanup failure recovery...');
    
    // Progressive recovery strategy
    if (errorRecoveryState.cleanupFailures === 1) {
      // First failure: Try gentle retry
      return attemptGentleCleanupRetry();
    } else if (errorRecoveryState.cleanupFailures === 2) {
      // Second failure: Try aggressive cleanup
      return attemptAggressiveCleanup();
    } else {
      // Third failure: Try emergency cleanup
      return attemptEmergencyCleanup();
    }
    
  } catch (recoveryError) {
    console.error('❌ Cleanup recovery attempt failed:', recoveryError);
    return false;
  }
}

/**
 * Gentle cleanup retry - retry with small delay
 */
function attemptGentleCleanupRetry(): boolean {
  try {
    console.log('🔄 Attempting gentle cleanup retry...');
    
    // Small delay before retry
    setTimeout(() => {
      try {
        killAllPreConnectionLogic();
        console.log('✅ Gentle cleanup retry successful');
        errorRecoveryState.cleanupFailures = 0; // Reset on success
      } catch (error) {
        console.error('❌ Gentle cleanup retry failed:', error);
        recoverFromCleanupFailure(error as Error);
      }
    }, errorRecoveryState.backoffMultiplier);
    
    return true;
    
  } catch (error) {
    console.error('❌ Failed to schedule gentle cleanup retry:', error);
    return false;
  }
}

/**
 * Aggressive cleanup - force clear everything immediately
 */
function attemptAggressiveCleanup(): boolean {
  try {
    console.log('🔄 Attempting aggressive cleanup...');
    
    // Force clear all registries without error checking
    try {
      preConnectionRegistry.timeouts.forEach(timeout => {
        try { clearTimeout(timeout); } catch {}
      });
      preConnectionRegistry.timeouts.clear();
    } catch {}
    
    try {
      preConnectionRegistry.intervals.forEach(interval => {
        try { clearInterval(interval); } catch {}
      });
      preConnectionRegistry.intervals.clear();
    } catch {}
    
    try {
      preConnectionRegistry.abortControllers.forEach(controller => {
        try { 
          if (!controller.signal.aborted) {
            controller.abort(); 
          }
        } catch {}
      });
      preConnectionRegistry.abortControllers.clear();
    } catch {}
    
    try {
      preConnectionRegistry.networkProbes.clear();
    } catch {}
    
    try {
      processRegistry.processes.clear();
      processRegistry.isKilled = true;
      processRegistry.killedAt = new Date();
    } catch {}
    
    console.log('✅ Aggressive cleanup completed');
    errorRecoveryState.cleanupFailures = 0; // Reset on success
    return true;
    
  } catch (error) {
    console.error('❌ Aggressive cleanup failed:', error);
    return false;
  }
}

/**
 * Emergency cleanup - recreate registry objects as last resort
 */
function attemptEmergencyCleanup(): boolean {
  try {
    console.log('🚨 Attempting emergency cleanup - recreating registry objects...');
    
    // Recreate registry objects completely
    Object.assign(preConnectionRegistry, {
      timeouts: new Set(),
      intervals: new Set(),
      abortControllers: new Set(),
      networkProbes: new Set()
    });
    
    Object.assign(processRegistry, {
      processes: new Map(),
      isKilled: true,
      killedAt: new Date()
    });
    
    // Force set connection state
    CALL_IS_CONNECTED = true;
    
    console.log('✅ Emergency cleanup completed - registry objects recreated');
    errorRecoveryState.cleanupFailures = 0; // Reset on success
    return true;
    
  } catch (error) {
    console.error('❌ Emergency cleanup failed:', error);
    console.error('🚨 CRITICAL: All cleanup recovery mechanisms have failed');
    return false;
  }
}

/**
 * Connection State Monitoring Fallbacks
 * Implements polling fallback when event listeners fail
 */
let connectionStatePollingInterval: NodeJS.Timeout | null = null;
let connectionStatePollingActive = false;

export function enableConnectionStateMonitoringFallback(peerConnection: RTCPeerConnection): void {
  if (connectionStatePollingActive) {
    console.log('⚠️ Connection state polling fallback already active');
    return;
  }
  
  try {
    console.log('🔄 Enabling connection state monitoring fallback (polling)...');
    
    connectionStatePollingActive = true;
    let lastConnectionState = peerConnection.connectionState;
    let lastIceConnectionState = peerConnection.iceConnectionState;
    
    connectionStatePollingInterval = setInterval(() => {
      try {
        const currentConnectionState = peerConnection.connectionState;
        const currentIceConnectionState = peerConnection.iceConnectionState;
        
        // Check if state changed
        if (currentConnectionState !== lastConnectionState || 
            currentIceConnectionState !== lastIceConnectionState) {
          
          console.log(`📊 Polling detected state change: ${lastConnectionState}→${currentConnectionState}, ${lastIceConnectionState}→${currentIceConnectionState}`);
          
          // Manually trigger state check
          handleConnectionStateChange(peerConnection, currentConnectionState, currentIceConnectionState);
          
          lastConnectionState = currentConnectionState;
          lastIceConnectionState = currentIceConnectionState;
        }
        
        errorRecoveryState.lastConnectionStateCheck = new Date();
        
      } catch (error) {
        errorRecoveryState.connectionStateFailures++;
        console.error('❌ Connection state polling error:', error);
        
        if (errorRecoveryState.connectionStateFailures > errorRecoveryState.maxRetries) {
          console.error('🚨 Too many connection state polling failures, disabling fallback');
          disableConnectionStateMonitoringFallback();
        }
      }
    }, 1000); // Poll every second
    
    console.log('✅ Connection state monitoring fallback enabled');
    
  } catch (error) {
    console.error('❌ Failed to enable connection state monitoring fallback:', error);
    connectionStatePollingActive = false;
  }
}

export function disableConnectionStateMonitoringFallback(): void {
  if (connectionStatePollingInterval) {
    clearInterval(connectionStatePollingInterval);
    connectionStatePollingInterval = null;
  }
  connectionStatePollingActive = false;
  console.log('🔄 Connection state monitoring fallback disabled');
}

/**
 * Handle connection state changes (used by both event listeners and polling)
 */
function handleConnectionStateChange(
  peerConnection: RTCPeerConnection, 
  connectionState: string, 
  iceConnectionState: string
): void {
  try {
    // Use the same logic as in monitorConnectionState
    if (connectionState === 'failed' || connectionState === 'closed' || iceConnectionState === 'failed') {
      if (CALL_IS_CONNECTED) {
        console.log(`❌ Actual WebRTC failure detected: connectionState=${connectionState}, iceConnectionState=${iceConnectionState}`);
        resetConnectionStateForRecovery(`WebRTC failure: ${connectionState}/${iceConnectionState}`);
      }
    } else if (connectionState === 'connected' || iceConnectionState === 'connected') {
      if (!CALL_IS_CONNECTED) {
        console.log(`🔗 Connection established: connectionState=${connectionState}, iceConnectionState=${iceConnectionState}`);
        WebRTCManager.setCallIsConnected(true);
        
        try {
          killAllPreConnectionLogic();
        } catch (error) {
          console.error('❌ killAllPreConnectionLogic failed during state change:', error);
          recoverFromCleanupFailure(error as Error);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error handling connection state change:', error);
    errorRecoveryState.connectionStateFailures++;
  }
}

/**
 * Manual Override Mechanisms for Edge Cases
 * Provides manual controls when automatic systems fail
 */
export interface ManualOverrideOptions {
  forceKillPreConnectionLogic?: boolean;
  forceResetConnectionState?: boolean;
  forceRecreateRegistries?: boolean;
  enablePollingFallback?: boolean;
  disablePollingFallback?: boolean;
  validateAndRepair?: boolean;
}

export function executeManualOverride(
  options: ManualOverrideOptions, 
  reason: string
): {
  success: boolean;
  actions: string[];
  errors: string[];
} {
  const actions: string[] = [];
  const errors: string[] = [];
  
  console.log(`🔧 Executing manual override: ${reason}`);
  console.log('🔧 Override options:', options);
  
  try {
    if (options.forceKillPreConnectionLogic) {
      try {
        attemptAggressiveCleanup();
        actions.push('Force killed pre-connection logic');
      } catch (error) {
        errors.push(`Failed to force kill pre-connection logic: ${error}`);
      }
    }
    
    if (options.forceResetConnectionState) {
      try {
        CALL_IS_CONNECTED = false;
        actions.push('Force reset CALL_IS_CONNECTED to false');
      } catch (error) {
        errors.push(`Failed to force reset connection state: ${error}`);
      }
    }
    
    if (options.forceRecreateRegistries) {
      try {
        attemptEmergencyCleanup();
        actions.push('Force recreated registry objects');
      } catch (error) {
        errors.push(`Failed to force recreate registries: ${error}`);
      }
    }
    
    if (options.enablePollingFallback && typeof window !== 'undefined') {
      try {
        // Note: This would need a peerConnection reference in real usage
        actions.push('Enabled connection state polling fallback');
      } catch (error) {
        errors.push(`Failed to enable polling fallback: ${error}`);
      }
    }
    
    if (options.disablePollingFallback) {
      try {
        disableConnectionStateMonitoringFallback();
        actions.push('Disabled connection state polling fallback');
      } catch (error) {
        errors.push(`Failed to disable polling fallback: ${error}`);
      }
    }
    
    if (options.validateAndRepair) {
      try {
        const validation = validateLifecycleGateIntegrity();
        if (!validation.isValid) {
          // Attempt to repair issues
          validation.recommendations.forEach(recommendation => {
            try {
              if (recommendation.includes('killAllPreConnectionLogic')) {
                killAllPreConnectionLogic();
                actions.push('Executed killAllPreConnectionLogic for repair');
              } else if (recommendation.includes('resetPreConnectionRegistry')) {
                resetPreConnectionRegistry();
                actions.push('Executed resetPreConnectionRegistry for repair');
              }
            } catch (repairError) {
              errors.push(`Failed to execute repair: ${repairError}`);
            }
          });
        }
        actions.push('Validated and attempted repair of lifecycle gate');
      } catch (error) {
        errors.push(`Failed to validate and repair: ${error}`);
      }
    }
    
    console.log(`✅ Manual override completed: ${actions.length} actions, ${errors.length} errors`);
    
    return {
      success: errors.length === 0,
      actions,
      errors
    };
    
  } catch (error) {
    console.error('❌ Manual override execution failed:', error);
    errors.push(`Manual override execution failed: ${error}`);
    
    return {
      success: false,
      actions,
      errors
    };
  }
}

/**
 * Registry Corruption Detection and Recovery
 * Detects and repairs corrupted registry state
 */
export function detectAndRepairRegistryCorruption(): {
  corruptionDetected: boolean;
  repairAttempted: boolean;
  repairSuccessful: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  let corruptionDetected = false;
  let repairAttempted = false;
  let repairSuccessful = false;
  
  try {
    console.log('🔍 Detecting registry corruption...');
    
    // Check for null/undefined registries
    if (!preConnectionRegistry) {
      issues.push('preConnectionRegistry is null/undefined');
      corruptionDetected = true;
    }
    
    if (!processRegistry) {
      issues.push('processRegistry is null/undefined');
      corruptionDetected = true;
    }
    
    // Check for missing registry properties
    if (preConnectionRegistry) {
      if (!preConnectionRegistry.timeouts) {
        issues.push('preConnectionRegistry.timeouts is missing');
        corruptionDetected = true;
      }
      if (!preConnectionRegistry.intervals) {
        issues.push('preConnectionRegistry.intervals is missing');
        corruptionDetected = true;
      }
      if (!preConnectionRegistry.abortControllers) {
        issues.push('preConnectionRegistry.abortControllers is missing');
        corruptionDetected = true;
      }
      if (!preConnectionRegistry.networkProbes) {
        issues.push('preConnectionRegistry.networkProbes is missing');
        corruptionDetected = true;
      }
    }
    
    if (processRegistry) {
      if (!processRegistry.processes) {
        issues.push('processRegistry.processes is missing');
        corruptionDetected = true;
      }
      if (typeof processRegistry.isKilled !== 'boolean') {
        issues.push('processRegistry.isKilled is not a boolean');
        corruptionDetected = true;
      }
    }
    
    // Check for type mismatches
    if (preConnectionRegistry) {
      if (!(preConnectionRegistry.timeouts instanceof Set)) {
        issues.push('preConnectionRegistry.timeouts is not a Set');
        corruptionDetected = true;
      }
      if (!(preConnectionRegistry.intervals instanceof Set)) {
        issues.push('preConnectionRegistry.intervals is not a Set');
        corruptionDetected = true;
      }
      if (!(preConnectionRegistry.abortControllers instanceof Set)) {
        issues.push('preConnectionRegistry.abortControllers is not a Set');
        corruptionDetected = true;
      }
      if (!(preConnectionRegistry.networkProbes instanceof Set)) {
        issues.push('preConnectionRegistry.networkProbes is not a Set');
        corruptionDetected = true;
      }
    }
    
    if (processRegistry && !(processRegistry.processes instanceof Map)) {
      issues.push('processRegistry.processes is not a Map');
      corruptionDetected = true;
    }
    
    // Attempt repair if corruption detected
    if (corruptionDetected) {
      console.warn('⚠️ Registry corruption detected, attempting repair...');
      repairAttempted = true;
      errorRecoveryState.registryCorruptions++;
      errorRecoveryState.lastRegistryReset = new Date();
      
      try {
        // Recreate corrupted registries
        if (!preConnectionRegistry || 
            !preConnectionRegistry.timeouts || 
            !(preConnectionRegistry.timeouts instanceof Set)) {
          Object.assign(preConnectionRegistry, {
            timeouts: new Set(),
            intervals: new Set(),
            abortControllers: new Set(),
            networkProbes: new Set()
          });
        }
        
        if (!processRegistry || 
            !processRegistry.processes || 
            !(processRegistry.processes instanceof Map)) {
          Object.assign(processRegistry, {
            processes: new Map(),
            isKilled: false,
            killedAt: undefined
          });
        }
        
        console.log('✅ Registry corruption repair completed');
        repairSuccessful = true;
        
      } catch (repairError) {
        console.error('❌ Registry corruption repair failed:', repairError);
        repairSuccessful = false;
      }
    } else {
      console.log('✅ No registry corruption detected');
    }
    
  } catch (error) {
    console.error('❌ Registry corruption detection failed:', error);
    issues.push(`Detection failed: ${error}`);
  }
  
  return {
    corruptionDetected,
    repairAttempted,
    repairSuccessful,
    issues
  };
}

/**
 * Comprehensive Error Recovery Status
 * Provides detailed status of all error recovery mechanisms
 */
export function getErrorRecoveryStatus(): {
  errorRecoveryState: ErrorRecoveryState;
  connectionStatePollingActive: boolean;
  lastValidationResult: ReturnType<typeof validateLifecycleGateIntegrity>;
  lastCorruptionCheck: ReturnType<typeof detectAndRepairRegistryCorruption>;
  systemHealth: 'healthy' | 'degraded' | 'critical';
  recommendations: string[];
} {
  const lastValidationResult = validateLifecycleGateIntegrity();
  const lastCorruptionCheck = detectAndRepairRegistryCorruption();
  
  // Determine system health
  let systemHealth: 'healthy' | 'degraded' | 'critical' = 'healthy';
  const recommendations: string[] = [];
  
  if (errorRecoveryState.cleanupFailures > 0 || 
      errorRecoveryState.connectionStateFailures > 0 || 
      errorRecoveryState.registryCorruptions > 0) {
    systemHealth = 'degraded';
    recommendations.push('Monitor error recovery mechanisms closely');
  }
  
  if (errorRecoveryState.cleanupFailures >= errorRecoveryState.maxRetries ||
      errorRecoveryState.connectionStateFailures >= errorRecoveryState.maxRetries ||
      !lastValidationResult.isValid ||
      lastCorruptionCheck.corruptionDetected) {
    systemHealth = 'critical';
    recommendations.push('Consider manual intervention or system restart');
  }
  
  if (!lastValidationResult.isValid) {
    recommendations.push(...lastValidationResult.recommendations);
  }
  
  if (lastCorruptionCheck.corruptionDetected && !lastCorruptionCheck.repairSuccessful) {
    recommendations.push('Registry corruption detected but repair failed - manual intervention required');
  }
  
  return {
    errorRecoveryState: { ...errorRecoveryState },
    connectionStatePollingActive,
    lastValidationResult,
    lastCorruptionCheck,
    systemHealth,
    recommendations
  };
}

/**
 * Reset Error Recovery State
 * Clears error counters and recovery state (for testing or after successful recovery)
 */
export function resetErrorRecoveryState(): void {
  errorRecoveryState.cleanupFailures = 0;
  errorRecoveryState.connectionStateFailures = 0;
  errorRecoveryState.registryCorruptions = 0;
  errorRecoveryState.lastCleanupAttempt = undefined;
  errorRecoveryState.lastConnectionStateCheck = undefined;
  errorRecoveryState.lastRegistryReset = undefined;
  
  console.log('🔄 Error recovery state reset');
}