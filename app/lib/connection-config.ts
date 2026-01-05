/**
 * Centralized Connection Configuration
 * 
 * This file contains all timeout, heartbeat, and connection-related configuration
 * values optimized for real-world network conditions and user experience.
 * 
 * Requirements: 4.1, 4.4 - Optimize timeout values and configure grace periods
 */

export interface ConnectionConfig {
  // Initial connection timeouts (for setup phase)
  initialConnectionTimeout: number;
  iceGatheringTimeout: number;
  connectionSetupExtension: number;
  
  // Established connection monitoring
  heartbeatInterval: number;
  sessionInactivityTimeout: number;
  activeCallInactivityTimeout: number;
  
  // Retry configuration
  maxReconnectAttempts: number;
  initialReconnectDelay: number;
  maxReconnectDelay: number;
  exponentialBackoffMultiplier: number;
  
  // Grace periods for temporary issues
  disconnectionGracePeriod: number;
  iceFailureGracePeriod: number;
  
  // Socket configuration
  socketTimeout: number;
  socketPingInterval: number;
  socketPingTimeout: number;
  
  // Session cleanup intervals
  sessionCleanupInterval: number;
  heartbeatCleanupInterval: number;
}

/**
 * Optimized configuration values for real-world network conditions
 * 
 * These values are based on:
 * - Typical network latency and reliability patterns
 * - User experience research for video chat applications
 * - Balance between responsiveness and stability
 * - Requirements 4.1 and 4.4 specifications
 */
export const CONNECTION_CONFIG: ConnectionConfig = {
  // Initial connection timeouts (Requirements 4.1)
  // Increased from 45s to 60s to allow sufficient time for ICE gathering
  initialConnectionTimeout: 60000, // 60 seconds for initial WebRTC setup
  
  // Increased from 10s to 15s for better ICE candidate collection
  iceGatheringTimeout: 15000, // 15 seconds for ICE gathering
  
  // Progressive timeout extension for connection setup retries
  connectionSetupExtension: 15000, // 15 seconds extension per retry
  
  // Established connection monitoring (Requirements 4.4)
  // Increased from 25s to 30s for better stability
  heartbeatInterval: 30000, // 30 seconds between heartbeats
  
  // Increased from 5 minutes to 10 minutes for non-active sessions
  sessionInactivityTimeout: 10 * 60 * 1000, // 10 minutes for inactive sessions
  
  // Separate timeout for active video calls - much longer
  activeCallInactivityTimeout: 30 * 60 * 1000, // 30 minutes for active calls
  
  // Retry configuration (Requirements 4.2)
  // Increased from 3 to 5 for better reliability
  maxReconnectAttempts: 5, // Maximum reconnection attempts
  
  // Base delay for exponential backoff
  initialReconnectDelay: 2000, // 2 seconds initial delay
  
  // Increased from 10s to 30s for reasonable maximum
  maxReconnectDelay: 30000, // 30 seconds maximum delay
  
  // Standard exponential backoff multiplier
  exponentialBackoffMultiplier: 2,
  
  // Grace periods for temporary connection issues (Requirements 4.4)
  // New: 10 second grace period for 'disconnected' state
  disconnectionGracePeriod: 10000, // 10 seconds grace for disconnections
  
  // New: 5 second grace period for ICE failures
  iceFailureGracePeriod: 5000, // 5 seconds grace for ICE failures
  
  // Socket.io configuration (Requirements 4.1, 4.4)
  // Increased from 20s to 30s for better stability
  socketTimeout: 30000, // 30 seconds socket timeout
  
  // Optimized ping intervals for better connection monitoring
  socketPingInterval: 25000, // 25 seconds between pings
  socketPingTimeout: 60000, // 60 seconds ping timeout
  
  // Session cleanup intervals
  // Reduced from 5 minutes to 2 minutes for more responsive cleanup
  sessionCleanupInterval: 2 * 60 * 1000, // 2 minutes cleanup interval
  
  // Heartbeat cleanup runs more frequently for better activity tracking
  heartbeatCleanupInterval: 2 * 60 * 1000, // 2 minutes heartbeat cleanup
};

/**
 * Calculate exponential backoff delay
 * 
 * @param attempt - Current attempt number (1-based)
 * @param baseDelay - Base delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @returns Calculated delay in milliseconds
 */
export function calculateExponentialBackoff(
  attempt: number, 
  baseDelay: number = CONNECTION_CONFIG.initialReconnectDelay,
  maxDelay: number = CONNECTION_CONFIG.maxReconnectDelay
): number {
  const exponentialDelay = baseDelay * Math.pow(CONNECTION_CONFIG.exponentialBackoffMultiplier, attempt - 1);
  return Math.min(exponentialDelay, maxDelay);
}

/**
 * Get timeout value based on connection phase
 * 
 * @param phase - Connection phase: 'initial' | 'established' | 'reconnecting'
 * @param isInActiveCall - Whether user is in an active video call
 * @returns Appropriate timeout value in milliseconds
 */
export function getTimeoutForPhase(
  phase: 'initial' | 'established' | 'reconnecting',
  isInActiveCall: boolean = false
): number {
  switch (phase) {
    case 'initial':
      return CONNECTION_CONFIG.initialConnectionTimeout;
    case 'established':
      // No timeout for established connections - they persist until explicit disconnect
      return 0;
    case 'reconnecting':
      return isInActiveCall 
        ? CONNECTION_CONFIG.activeCallInactivityTimeout 
        : CONNECTION_CONFIG.sessionInactivityTimeout;
    default:
      return CONNECTION_CONFIG.initialConnectionTimeout;
  }
}

/**
 * Get session timeout based on activity status
 * 
 * @param isInActiveCall - Whether user is in an active video call
 * @returns Appropriate session timeout in milliseconds
 */
export function getSessionTimeout(isInActiveCall: boolean): number {
  return isInActiveCall 
    ? CONNECTION_CONFIG.activeCallInactivityTimeout 
    : CONNECTION_CONFIG.sessionInactivityTimeout;
}

/**
 * Configuration validation
 * Ensures all timeout values are reasonable and consistent
 */
export function validateConfiguration(): boolean {
  const config = CONNECTION_CONFIG;
  
  // Validate that timeouts are positive
  const timeoutValues = [
    config.initialConnectionTimeout,
    config.iceGatheringTimeout,
    config.heartbeatInterval,
    config.sessionInactivityTimeout,
    config.activeCallInactivityTimeout,
    config.initialReconnectDelay,
    config.maxReconnectDelay,
    config.disconnectionGracePeriod,
    config.iceFailureGracePeriod,
    config.socketTimeout,
    config.socketPingInterval,
    config.socketPingTimeout
  ];
  
  if (timeoutValues.some(value => value <= 0)) {
    console.error('Invalid configuration: All timeout values must be positive');
    return false;
  }
  
  // Validate that max delays are greater than initial delays
  if (config.maxReconnectDelay < config.initialReconnectDelay) {
    console.error('Invalid configuration: maxReconnectDelay must be >= initialReconnectDelay');
    return false;
  }
  
  // Validate that active call timeout is longer than regular session timeout
  if (config.activeCallInactivityTimeout < config.sessionInactivityTimeout) {
    console.error('Invalid configuration: activeCallInactivityTimeout should be >= sessionInactivityTimeout');
    return false;
  }
  
  // Validate that grace periods are reasonable (less than initial connection timeout)
  if (config.disconnectionGracePeriod >= config.initialConnectionTimeout ||
      config.iceFailureGracePeriod >= config.initialConnectionTimeout) {
    console.error('Invalid configuration: Grace periods should be less than initial connection timeout');
    return false;
  }
  
  console.log('✅ Connection configuration validation passed');
  return true;
}

// Validate configuration on module load
if (typeof window !== 'undefined') {
  // Only validate in browser environment
  validateConfiguration();
}

/**
 * Export individual configuration values for backward compatibility
 */
export const {
  initialConnectionTimeout: INITIAL_CONNECTION_TIMEOUT_MS,
  iceGatheringTimeout: ICE_GATHERING_TIMEOUT_MS,
  connectionSetupExtension: CONNECTION_SETUP_EXTENSION_MS,
  heartbeatInterval: HEARTBEAT_INTERVAL_MS,
  sessionInactivityTimeout: SESSION_INACTIVITY_TIMEOUT_MS,
  activeCallInactivityTimeout: ACTIVE_CALL_INACTIVITY_TIMEOUT_MS,
  maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
  initialReconnectDelay: INITIAL_RECONNECT_DELAY_MS,
  maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
  exponentialBackoffMultiplier: EXPONENTIAL_BACKOFF_MULTIPLIER,
  disconnectionGracePeriod: DISCONNECTION_GRACE_PERIOD_MS,
  iceFailureGracePeriod: ICE_FAILURE_GRACE_PERIOD_MS,
  socketTimeout: SOCKET_TIMEOUT_MS,
  socketPingInterval: SOCKET_PING_INTERVAL_MS,
  socketPingTimeout: SOCKET_PING_TIMEOUT_MS,
  sessionCleanupInterval: SESSION_CLEANUP_INTERVAL_MS,
  heartbeatCleanupInterval: HEARTBEAT_CLEANUP_INTERVAL_MS
} = CONNECTION_CONFIG;