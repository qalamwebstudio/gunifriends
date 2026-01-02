/**
 * WebRTC Connection State Manager
 * Handles connection state tracking and management for video chat sessions
 */

class WebRTCManager {
  constructor() {
    this.connections = new Map();
  }

  /**
   * Create a new WebRTC connection tracking entry
   */
  createConnection(roomId, user1Id, user2Id) {
    const connection = {
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
  updateConnectionState(roomId, newState) {
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
  getConnection(roomId) {
    return this.connections.get(roomId) || null;
  }

  /**
   * Get connection by user ID
   */
  getConnectionByUserId(userId) {
    for (const connection of this.connections.values()) {
      if (connection.user1Id === userId || connection.user2Id === userId) {
        return connection;
      }
    }
    return null;
  }

  /**
   * Remove connection
   */
  removeConnection(roomId) {
    const removed = this.connections.delete(roomId);
    if (removed) {
      console.log(`WebRTC connection removed: ${roomId}`);
    }
    return removed;
  }

  /**
   * Clean up old connections
   */
  cleanupOldConnections(maxAgeMinutes = 60) {
    const now = new Date();
    const maxAge = maxAgeMinutes * 60 * 1000;
    let cleanedCount = 0;

    for (const [roomId, connection] of this.connections.entries()) {
      const age = now.getTime() - connection.lastActivity.getTime();
      
      if (age > maxAge && (connection.state === 'disconnected' || connection.state === 'failed' || connection.state === 'closed')) {
        this.connections.delete(roomId);
        cleanedCount++;
        console.log(`Cleaned up old WebRTC connection: ${roomId}`);
      }
    }

    return cleanedCount;
  }
}

module.exports = { WebRTCManager };