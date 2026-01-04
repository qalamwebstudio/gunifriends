/**
 * Socket Server Connection Configuration
 * 
 * JavaScript version of connection configuration for the socket server.
 * These values should match the TypeScript configuration in app/lib/connection-config.ts
 * 
 * Requirements: 4.1, 4.4 - Optimize timeout values and configure grace periods
 */

/**
 * Optimized configuration values for real-world network conditions
 */
const CONNECTION_CONFIG = {
  // Initial connection timeouts (Requirements 4.1)
  initialConnectionTimeout: 60000, // 60 seconds for initial WebRTC setup
  iceGatheringTimeout: 15000, // 15 seconds for ICE gathering
  connectionSetupExtension: 15000, // 15 seconds extension per retry
  
  // Established connection monitoring (Requirements 4.4)
  heartbeatInterval: 30000, // 30 seconds between heartbeats
  sessionInactivityTimeout: 10 * 60 * 1000, // 10 minutes for inactive sessions
  activeCallInactivityTimeout: 30 * 60 * 1000, // 30 minutes for active calls
  
  // Retry configuration (Requirements 4.2)
  maxReconnectAttempts: 5, // Maximum reconnection attempts
  initialReconnectDelay: 2000, // 2 seconds initial delay
  maxReconnectDelay: 30000, // 30 seconds maximum delay
  exponentialBackoffMultiplier: 2,
  
  // Grace periods for temporary connection issues (Requirements 4.4)
  disconnectionGracePeriod: 10000, // 10 seconds grace for disconnections
  iceFailureGracePeriod: 5000, // 5 seconds grace for ICE failures
  
  // Socket.io configuration (Requirements 4.1, 4.4)
  socketTimeout: 30000, // 30 seconds socket timeout
  socketPingInterval: 25000, // 25 seconds between pings
  socketPingTimeout: 60000, // 60 seconds ping timeout
  
  // Session cleanup intervals
  sessionCleanupInterval: 2 * 60 * 1000, // 2 minutes cleanup interval
  heartbeatCleanupInterval: 2 * 60 * 1000, // 2 minutes heartbeat cleanup
};

/**
 * Calculate exponential backoff delay
 * 
 * @param {number} attempt - Current attempt number (1-based)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @returns {number} Calculated delay in milliseconds
 */
function calculateExponentialBackoff(
  attempt, 
  baseDelay = CONNECTION_CONFIG.initialReconnectDelay,
  maxDelay = CONNECTION_CONFIG.maxReconnectDelay
) {
  const exponentialDelay = baseDelay * Math.pow(CONNECTION_CONFIG.exponentialBackoffMultiplier, attempt - 1);
  return Math.min(exponentialDelay, maxDelay);
}

/**
 * Get session timeout based on activity status
 * 
 * @param {boolean} isInActiveCall - Whether user is in an active video call
 * @returns {number} Appropriate session timeout in milliseconds
 */
function getSessionTimeout(isInActiveCall) {
  return isInActiveCall 
    ? CONNECTION_CONFIG.activeCallInactivityTimeout 
    : CONNECTION_CONFIG.sessionInactivityTimeout;
}

/**
 * Configuration validation
 * Ensures all timeout values are reasonable and consistent
 */
function validateConfiguration() {
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
  
  console.log('✅ Socket server connection configuration validation passed');
  return true;
}

// Validate configuration on module load
validateConfiguration();

module.exports = {
  CONNECTION_CONFIG,
  calculateExponentialBackoff,
  getSessionTimeout,
  validateConfiguration
};