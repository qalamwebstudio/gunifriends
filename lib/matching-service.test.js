const { MatchingService } = require('./matching-service');

describe('MatchingService', () => {
  let matchingService;
  let matchingPool;
  let activeSessions;

  beforeEach(() => {
    matchingPool = new Set();
    activeSessions = new Map();
    matchingService = new MatchingService(matchingPool, activeSessions);
  });

  describe('addToPool', () => {
    it('should add user to pool when session exists and user is not matched', () => {
      const userId = 'user1';
      activeSessions.set(userId, {
        id: 'session1',
        userId,
        status: 'waiting',
        joinedAt: new Date(),
        lastActivity: new Date()
      });

      const result = matchingService.addToPool(userId);

      expect(result).toBe(true);
      expect(matchingPool.has(userId)).toBe(true);
      expect(activeSessions.get(userId).status).toBe('waiting');
    });

    it('should not add user to pool if already matched', () => {
      const userId = 'user1';
      activeSessions.set(userId, {
        id: 'session1',
        userId,
        status: 'matched',
        joinedAt: new Date(),
        lastActivity: new Date()
      });

      const result = matchingService.addToPool(userId);

      expect(result).toBe(false);
      expect(matchingPool.has(userId)).toBe(false);
    });

    it('should not add user to pool if already in call', () => {
      const userId = 'user1';
      activeSessions.set(userId, {
        id: 'session1',
        userId,
        status: 'in-call',
        joinedAt: new Date(),
        lastActivity: new Date()
      });

      const result = matchingService.addToPool(userId);

      expect(result).toBe(false);
      expect(matchingPool.has(userId)).toBe(false);
    });

    it('should not add user to pool if session does not exist', () => {
      const userId = 'user1';

      const result = matchingService.addToPool(userId);

      expect(result).toBe(false);
      expect(matchingPool.has(userId)).toBe(false);
    });
  });

  describe('removeFromPool', () => {
    it('should remove user from pool successfully', () => {
      const userId = 'user1';
      matchingPool.add(userId);
      activeSessions.set(userId, {
        id: 'session1',
        userId,
        status: 'waiting',
        joinedAt: new Date(),
        lastActivity: new Date()
      });

      const result = matchingService.removeFromPool(userId);

      expect(result).toBe(true);
      expect(matchingPool.has(userId)).toBe(false);
    });

    it('should return false when user is not in pool', () => {
      const userId = 'user1';

      const result = matchingService.removeFromPool(userId);

      expect(result).toBe(false);
    });
  });

  describe('findMatch - Edge Cases', () => {
    it('should return null when no other users are available', () => {
      const userId = 'user1';
      activeSessions.set(userId, {
        id: 'session1',
        userId,
        status: 'waiting',
        joinedAt: new Date(),
        lastActivity: new Date()
      });
      matchingPool.add(userId);

      const partnerId = matchingService.findMatch(userId);

      expect(partnerId).toBeNull();
      expect(matchingPool.has(userId)).toBe(true); // User should be added back to pool
    });

    it('should prevent self-matching', () => {
      const userId = 'user1';
      activeSessions.set(userId, {
        id: 'session1',
        userId,
        status: 'waiting',
        joinedAt: new Date(),
        lastActivity: new Date()
      });
      matchingPool.add(userId);

      const partnerId = matchingService.findMatch(userId);

      expect(partnerId).toBeNull();
      expect(partnerId).not.toBe(userId);
    });

    it('should find match when multiple users are available', () => {
      const user1Id = 'user1';
      const user2Id = 'user2';
      const user3Id = 'user3';

      // Set up sessions
      [user1Id, user2Id, user3Id].forEach(userId => {
        activeSessions.set(userId, {
          id: `session_${userId}`,
          userId,
          status: 'waiting',
          joinedAt: new Date(),
          lastActivity: new Date()
        });
        matchingPool.add(userId);
      });

      const partnerId = matchingService.findMatch(user1Id);

      expect(partnerId).not.toBeNull();
      expect(partnerId).not.toBe(user1Id);
      expect([user2Id, user3Id]).toContain(partnerId);
      expect(matchingPool.has(user1Id)).toBe(false);
      expect(matchingPool.has(partnerId)).toBe(false);
    });

    it('should handle concurrent matching requests', () => {
      const user1Id = 'user1';
      const user2Id = 'user2';

      // Set up sessions
      [user1Id, user2Id].forEach(userId => {
        activeSessions.set(userId, {
          id: `session_${userId}`,
          userId,
          status: 'waiting',
          joinedAt: new Date(),
          lastActivity: new Date()
        });
        matchingPool.add(userId);
      });

      const partner1 = matchingService.findMatch(user1Id);
      const partner2 = matchingService.findMatch(user2Id);

      // First match should succeed
      expect(partner1).toBe(user2Id);
      // Second match should fail (no one left in pool)
      expect(partner2).toBeNull();
      expect(matchingPool.size).toBe(1); // user2Id should be back in pool
    });
  });

  describe('createMatch', () => {
    it('should create match successfully with valid users', () => {
      const user1Id = 'user1';
      const user2Id = 'user2';

      // Set up sessions
      activeSessions.set(user1Id, {
        id: 'session1',
        userId: user1Id,
        status: 'waiting',
        joinedAt: new Date(),
        lastActivity: new Date()
      });
      activeSessions.set(user2Id, {
        id: 'session2',
        userId: user2Id,
        status: 'waiting',
        joinedAt: new Date(),
        lastActivity: new Date()
      });

      const match = matchingService.createMatch(user1Id, user2Id);

      expect(match).not.toBeNull();
      expect(match.user1Id).toBe(user1Id);
      expect(match.user2Id).toBe(user2Id);
      expect(match.id).toMatch(/^room_\d+_[a-f0-9]{16}$/);
      expect(match.startedAt).toBeInstanceOf(Date);

      // Check session updates
      expect(activeSessions.get(user1Id).status).toBe('matched');
      expect(activeSessions.get(user1Id).matchedWith).toBe(user2Id);
      expect(activeSessions.get(user2Id).status).toBe('matched');
      expect(activeSessions.get(user2Id).matchedWith).toBe(user1Id);

      // Check match is stored
      expect(matchingService.activeMatches.has(match.id)).toBe(true);
    });

    it('should return null when user1 session does not exist', () => {
      const user1Id = 'user1';
      const user2Id = 'user2';

      activeSessions.set(user2Id, {
        id: 'session2',
        userId: user2Id,
        status: 'waiting',
        joinedAt: new Date(),
        lastActivity: new Date()
      });

      const match = matchingService.createMatch(user1Id, user2Id);

      expect(match).toBeNull();
    });

    it('should return null when user2 session does not exist', () => {
      const user1Id = 'user1';
      const user2Id = 'user2';

      activeSessions.set(user1Id, {
        id: 'session1',
        userId: user1Id,
        status: 'waiting',
        joinedAt: new Date(),
        lastActivity: new Date()
      });

      const match = matchingService.createMatch(user1Id, user2Id);

      expect(match).toBeNull();
    });
  });

  describe('endMatch', () => {
    it('should end match successfully and clean up sessions', (done) => {
      const user1Id = 'user1';
      const user2Id = 'user2';
      const matchId = 'room_123_abc';

      // Set up sessions
      activeSessions.set(user1Id, {
        id: 'session1',
        userId: user1Id,
        status: 'matched',
        matchedWith: user2Id,
        joinedAt: new Date(),
        lastActivity: new Date()
      });
      activeSessions.set(user2Id, {
        id: 'session2',
        userId: user2Id,
        status: 'matched',
        matchedWith: user1Id,
        joinedAt: new Date(),
        lastActivity: new Date()
      });

      // Set up match
      const match = {
        id: matchId,
        user1Id,
        user2Id,
        startedAt: new Date()
      };
      matchingService.activeMatches.set(matchId, match);

      // Add small delay to ensure duration > 0
      setTimeout(() => {
        const result = matchingService.endMatch(matchId, 'normal');

        expect(result).toBe(true);
        expect(matchingService.activeMatches.has(matchId)).toBe(false);

        // Check session cleanup
        expect(activeSessions.get(user1Id).status).toBe('waiting');
        expect(activeSessions.get(user1Id).matchedWith).toBeUndefined();
        expect(activeSessions.get(user2Id).status).toBe('waiting');
        expect(activeSessions.get(user2Id).matchedWith).toBeUndefined();

        // Check match record is updated
        expect(match.endedAt).toBeInstanceOf(Date);
        expect(match.endReason).toBe('normal');
        expect(match.duration).toBeGreaterThan(0);
        
        done();
      }, 1);
    });

    it('should return false when match does not exist', () => {
      const matchId = 'nonexistent_match';

      const result = matchingService.endMatch(matchId);

      expect(result).toBe(false);
    });
  });

  describe('getMatchByUserId', () => {
    it('should find match by user1Id', () => {
      const user1Id = 'user1';
      const user2Id = 'user2';
      const matchId = 'room_123_abc';

      const match = {
        id: matchId,
        user1Id,
        user2Id,
        startedAt: new Date()
      };
      matchingService.activeMatches.set(matchId, match);

      const foundMatch = matchingService.getMatchByUserId(user1Id);

      expect(foundMatch).toBe(match);
    });

    it('should find match by user2Id', () => {
      const user1Id = 'user1';
      const user2Id = 'user2';
      const matchId = 'room_123_abc';

      const match = {
        id: matchId,
        user1Id,
        user2Id,
        startedAt: new Date()
      };
      matchingService.activeMatches.set(matchId, match);

      const foundMatch = matchingService.getMatchByUserId(user2Id);

      expect(foundMatch).toBe(match);
    });

    it('should return null when user has no active match', () => {
      const userId = 'user1';

      const foundMatch = matchingService.getMatchByUserId(userId);

      expect(foundMatch).toBeNull();
    });
  });

  describe('cleanupInactiveSessions', () => {
    it('should remove inactive users from matching pool', () => {
      const activeUserId = 'active_user';
      const inactiveUserId = 'inactive_user';
      const now = new Date();
      const oldTime = new Date(now.getTime() - 35 * 60 * 1000); // 35 minutes ago

      // Set up active user
      activeSessions.set(activeUserId, {
        id: 'session1',
        userId: activeUserId,
        status: 'waiting',
        joinedAt: now,
        lastActivity: now
      });
      matchingPool.add(activeUserId);

      // Set up inactive user
      activeSessions.set(inactiveUserId, {
        id: 'session2',
        userId: inactiveUserId,
        status: 'waiting',
        joinedAt: oldTime,
        lastActivity: oldTime
      });
      matchingPool.add(inactiveUserId);

      const cleanedCount = matchingService.cleanupInactiveSessions(30);

      expect(cleanedCount).toBe(1);
      expect(matchingPool.has(activeUserId)).toBe(true);
      expect(matchingPool.has(inactiveUserId)).toBe(false);
    });

    it('should remove users with no session from matching pool', () => {
      const userWithoutSession = 'no_session_user';
      matchingPool.add(userWithoutSession);

      const cleanedCount = matchingService.cleanupInactiveSessions(30);

      expect(cleanedCount).toBe(1);
      expect(matchingPool.has(userWithoutSession)).toBe(false);
    });
  });
});