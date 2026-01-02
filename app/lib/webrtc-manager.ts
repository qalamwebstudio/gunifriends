/**
 * WebRTC Connection State Manager
 * Handles connection state tracking and management for video chat sessions
 */

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

    for (const connection of this.connections.values()) {
      stats.byState[connection.state]++;
      if (connection.state === 'connecting' || connection.state === 'connected') {
        stats.active++;
      }
    }

    return stats;
  }
}