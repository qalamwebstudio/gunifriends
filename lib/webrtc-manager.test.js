const { WebRTCManager } = require('./webrtc-manager');

describe('WebRTCManager', () => {
  let webrtcManager;

  beforeEach(() => {
    webrtcManager = new WebRTCManager();
  });

  describe('createConnection', () => {
    it('should create new WebRTC connection successfully', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';

      const connection = webrtcManager.createConnection(roomId, user1Id, user2Id);

      expect(connection).not.toBeNull();
      expect(connection.id).toBe(roomId);
      expect(connection.user1Id).toBe(user1Id);
      expect(connection.user2Id).toBe(user2Id);
      expect(connection.state).toBe('new');
      expect(connection.createdAt).toBeInstanceOf(Date);
      expect(connection.lastActivity).toBeInstanceOf(Date);

      // Check connection is stored
      expect(webrtcManager.connections.has(roomId)).toBe(true);
    });

    it('should overwrite existing connection with same roomId', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';
      const user3Id = 'user3';

      // Create first connection
      const connection1 = webrtcManager.createConnection(roomId, user1Id, user2Id);
      
      // Create second connection with same roomId
      const connection2 = webrtcManager.createConnection(roomId, user1Id, user3Id);

      expect(webrtcManager.connections.size).toBe(1);
      expect(webrtcManager.getConnection(roomId)).toBe(connection2);
      expect(webrtcManager.getConnection(roomId).user2Id).toBe(user3Id);
    });
  });

  describe('updateConnectionState', () => {
    it('should update connection state successfully', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';

      webrtcManager.createConnection(roomId, user1Id, user2Id);
      const oldActivity = webrtcManager.getConnection(roomId).lastActivity;

      // Wait a bit to ensure timestamp difference
      setTimeout(() => {
        const result = webrtcManager.updateConnectionState(roomId, 'connecting');

        expect(result).toBe(true);
        const connection = webrtcManager.getConnection(roomId);
        expect(connection.state).toBe('connecting');
        expect(connection.lastActivity.getTime()).toBeGreaterThan(oldActivity.getTime());
      }, 1);
    });

    it('should set connectedAt timestamp when transitioning to connected', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';

      webrtcManager.createConnection(roomId, user1Id, user2Id);
      
      const result = webrtcManager.updateConnectionState(roomId, 'connected');

      expect(result).toBe(true);
      const connection = webrtcManager.getConnection(roomId);
      expect(connection.state).toBe('connected');
      expect(connection.connectedAt).toBeInstanceOf(Date);
    });

    it('should set disconnectedAt timestamp when transitioning to disconnected states', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';

      webrtcManager.createConnection(roomId, user1Id, user2Id);
      
      const disconnectedStates = ['disconnected', 'failed', 'closed'];
      
      disconnectedStates.forEach(state => {
        const result = webrtcManager.updateConnectionState(roomId, state);
        
        expect(result).toBe(true);
        const connection = webrtcManager.getConnection(roomId);
        expect(connection.state).toBe(state);
        expect(connection.disconnectedAt).toBeInstanceOf(Date);
      });
    });

    it('should return false when connection does not exist', () => {
      const roomId = 'nonexistent_room';

      const result = webrtcManager.updateConnectionState(roomId, 'connecting');

      expect(result).toBe(false);
    });

    it('should handle multiple state transitions correctly', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';

      webrtcManager.createConnection(roomId, user1Id, user2Id);
      
      // Test state progression
      expect(webrtcManager.updateConnectionState(roomId, 'connecting')).toBe(true);
      expect(webrtcManager.getConnection(roomId).state).toBe('connecting');
      
      expect(webrtcManager.updateConnectionState(roomId, 'connected')).toBe(true);
      expect(webrtcManager.getConnection(roomId).state).toBe('connected');
      expect(webrtcManager.getConnection(roomId).connectedAt).toBeInstanceOf(Date);
      
      expect(webrtcManager.updateConnectionState(roomId, 'disconnected')).toBe(true);
      expect(webrtcManager.getConnection(roomId).state).toBe('disconnected');
      expect(webrtcManager.getConnection(roomId).disconnectedAt).toBeInstanceOf(Date);
    });
  });

  describe('getConnection', () => {
    it('should return connection when it exists', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';

      const originalConnection = webrtcManager.createConnection(roomId, user1Id, user2Id);
      const retrievedConnection = webrtcManager.getConnection(roomId);

      expect(retrievedConnection).toBe(originalConnection);
    });

    it('should return null when connection does not exist', () => {
      const roomId = 'nonexistent_room';

      const connection = webrtcManager.getConnection(roomId);

      expect(connection).toBeNull();
    });
  });

  describe('getConnectionByUserId', () => {
    it('should find connection by user1Id', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';

      const originalConnection = webrtcManager.createConnection(roomId, user1Id, user2Id);
      const foundConnection = webrtcManager.getConnectionByUserId(user1Id);

      expect(foundConnection).toBe(originalConnection);
    });

    it('should find connection by user2Id', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';

      const originalConnection = webrtcManager.createConnection(roomId, user1Id, user2Id);
      const foundConnection = webrtcManager.getConnectionByUserId(user2Id);

      expect(foundConnection).toBe(originalConnection);
    });

    it('should return null when user has no connection', () => {
      const userId = 'user_without_connection';

      const connection = webrtcManager.getConnectionByUserId(userId);

      expect(connection).toBeNull();
    });

    it('should return first matching connection when user has multiple connections', () => {
      const roomId1 = 'room_123';
      const roomId2 = 'room_456';
      const user1Id = 'user1';
      const user2Id = 'user2';
      const user3Id = 'user3';

      const connection1 = webrtcManager.createConnection(roomId1, user1Id, user2Id);
      const connection2 = webrtcManager.createConnection(roomId2, user1Id, user3Id);

      const foundConnection = webrtcManager.getConnectionByUserId(user1Id);

      // Should return one of the connections (implementation returns first found)
      expect([connection1, connection2]).toContain(foundConnection);
    });
  });

  describe('removeConnection', () => {
    it('should remove connection successfully', () => {
      const roomId = 'room_123';
      const user1Id = 'user1';
      const user2Id = 'user2';

      webrtcManager.createConnection(roomId, user1Id, user2Id);
      expect(webrtcManager.connections.has(roomId)).toBe(true);

      const result = webrtcManager.removeConnection(roomId);

      expect(result).toBe(true);
      expect(webrtcManager.connections.has(roomId)).toBe(false);
    });

    it('should return false when connection does not exist', () => {
      const roomId = 'nonexistent_room';

      const result = webrtcManager.removeConnection(roomId);

      expect(result).toBe(false);
    });
  });

  describe('cleanupOldConnections', () => {
    it('should remove old disconnected connections', () => {
      const roomId1 = 'room_old';
      const roomId2 = 'room_recent';
      const user1Id = 'user1';
      const user2Id = 'user2';
      const now = new Date();
      const oldTime = new Date(now.getTime() - 70 * 60 * 1000); // 70 minutes ago

      // Create old disconnected connection
      const oldConnection = webrtcManager.createConnection(roomId1, user1Id, user2Id);
      oldConnection.lastActivity = oldTime;
      oldConnection.state = 'disconnected';

      // Create recent connection
      const recentConnection = webrtcManager.createConnection(roomId2, user1Id, user2Id);
      recentConnection.lastActivity = now;
      recentConnection.state = 'connected';

      const cleanedCount = webrtcManager.cleanupOldConnections(60);

      expect(cleanedCount).toBe(1);
      expect(webrtcManager.connections.has(roomId1)).toBe(false);
      expect(webrtcManager.connections.has(roomId2)).toBe(true);
    });

    it('should not remove old connections that are still active', () => {
      const roomId = 'room_old_active';
      const user1Id = 'user1';
      const user2Id = 'user2';
      const now = new Date();
      const oldTime = new Date(now.getTime() - 70 * 60 * 1000); // 70 minutes ago

      // Create old but still active connection
      const connection = webrtcManager.createConnection(roomId, user1Id, user2Id);
      connection.lastActivity = oldTime;
      connection.state = 'connected'; // Still active

      const cleanedCount = webrtcManager.cleanupOldConnections(60);

      expect(cleanedCount).toBe(0);
      expect(webrtcManager.connections.has(roomId)).toBe(true);
    });

    it('should clean up multiple old connections', () => {
      const user1Id = 'user1';
      const user2Id = 'user2';
      const now = new Date();
      const oldTime = new Date(now.getTime() - 70 * 60 * 1000); // 70 minutes ago

      const oldRooms = ['room1', 'room2', 'room3'];
      const disconnectedStates = ['disconnected', 'failed', 'closed'];

      // Create multiple old disconnected connections
      oldRooms.forEach((roomId, index) => {
        const connection = webrtcManager.createConnection(roomId, user1Id, user2Id);
        connection.lastActivity = oldTime;
        connection.state = disconnectedStates[index];
      });

      const cleanedCount = webrtcManager.cleanupOldConnections(60);

      expect(cleanedCount).toBe(3);
      oldRooms.forEach(roomId => {
        expect(webrtcManager.connections.has(roomId)).toBe(false);
      });
    });
  });
});