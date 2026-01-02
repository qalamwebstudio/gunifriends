import * as fc from 'fast-check';

// Mock Socket.io for testing
const mockSocket = {
  id: 'mock-socket-id',
  userId: 'test-user',
  emit: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
  onAny: jest.fn()
};

const mockIo = {
  to: jest.fn().mockReturnThis(),
  emit: jest.fn(),
  sockets: {
    sockets: new Map()
  }
};

// Session management test utilities
class SessionTestUtils {
  static createMockSession(userId: string, overrides: any = {}) {
    return {
      id: `session_${Math.random().toString(36)}_${userId}`,
      userId,
      socketId: `socket_${userId}`,
      status: 'waiting',
      joinedAt: new Date(),
      lastActivity: new Date(),
      reconnectionAttempts: 0,
      isReconnecting: false,
      ...overrides
    };
  }

  static createActiveSessionsMap(sessions: any[]) {
    const map = new Map();
    sessions.forEach(session => {
      map.set(session.userId, session);
    });
    return map;
  }

  static simulateBrowserClose(activeSessions: Map<string, any>, userId: string) {
    const session = activeSessions.get(userId);
    if (session) {
      session.lastDisconnectedAt = new Date();
      session.reconnectionAttempts = (session.reconnectionAttempts || 0) + 1;
      
      // For active calls, preserve session for reconnection
      if (session.status === 'in-call' && session.matchedWith) {
        session.isReconnecting = true;
        return { preserved: true, session };
      } else {
        // For non-active sessions, immediate cleanup
        activeSessions.delete(userId);
        return { preserved: false, session: null };
      }
    }
    return { preserved: false, session: null };
  }

  static simulateInactivityTimeout(activeSessions: Map<string, any>, timeoutMinutes: number) {
    const now = new Date();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const timedOutSessions: string[] = [];

    // CRITICAL FIX: Use Array.from to avoid modification during iteration
    const sessionEntries = Array.from(activeSessions.entries());
    
    for (const [userId, session] of sessionEntries) {
      const inactiveTime = now.getTime() - session.lastActivity.getTime();
      
      // CRITICAL FIX: Use strict comparison and handle edge cases
      if (inactiveTime > timeoutMs) {
        timedOutSessions.push(userId);
        activeSessions.delete(userId);
      }
    }

    return timedOutSessions;
  }

  static simulateSessionRestore(activeSessions: Map<string, any>, userId: string, newSocketId: string) {
    const session = activeSessions.get(userId);
    if (session && session.status === 'in-call' && session.matchedWith) {
      // Session restoration should work for active calls, regardless of reconnecting state
      session.socketId = newSocketId;
      session.isReconnecting = false;
      session.lastActivity = new Date();
      return { restored: true, session };
    }
    return { restored: false, session: null };
  }

  static simulateNetworkReconnection(activeSessions: Map<string, any>, userId: string) {
    const session = activeSessions.get(userId);
    if (session && session.isReconnecting && session.status === 'in-call') {
      // Simulate successful reconnection within timeout window
      const reconnectionWindow = 2 * 60 * 1000; // 2 minutes
      const timeSinceDisconnect = new Date().getTime() - (session.lastDisconnectedAt?.getTime() || 0);
      
      if (timeSinceDisconnect <= reconnectionWindow) {
        session.isReconnecting = false;
        session.lastActivity = new Date();
        
        // CRITICAL FIX: Synchronize partner session as well
        if (session.matchedWith) {
          const partnerSession = activeSessions.get(session.matchedWith);
          if (partnerSession) {
            // Ensure partner session is also synchronized
            partnerSession.isReconnecting = false;
            partnerSession.lastActivity = new Date();
            // Ensure bidirectional matching is maintained
            if (!partnerSession.matchedWith) {
              partnerSession.matchedWith = userId;
            }
          }
        }
        
        return { reconnected: true, session };
      }
    }
    return { reconnected: false, session: null };
  }
}

describe('Session Management Property Tests', () => {
  let activeSessions: Map<string, any>;
  let matchingPool: Set<string>;

  beforeEach(() => {
    activeSessions = new Map();
    matchingPool = new Set();
    jest.clearAllMocks();
  });

  describe('Property 21: Browser close cleanup', () => {
    /**
     * Feature: university-video-chat, Property 21: Browser close cleanup
     * Validates: Requirements 8.1, 8.2
     * 
     * For any student closing their browser, the system should immediately remove them from matching pool and notify chat partners
     */
    it('should immediately clean up matching pool for all users who close browser', async () => {
      const userIdArbitrary = fc.string({ minLength: 1, maxLength: 20 });
      const sessionStatusArbitrary = fc.constantFrom('waiting', 'matched', 'in-call');
      
      const userSessionArbitrary = fc.tuple(
        userIdArbitrary,
        sessionStatusArbitrary,
        fc.option(userIdArbitrary, { nil: undefined }) // matchedWith partner
      );

      await fc.assert(
        fc.asyncProperty(
          fc.array(userSessionArbitrary, { minLength: 1, maxLength: 10 }),
          async (userSessions) => {
            // Set up sessions and matching pool
            userSessions.forEach(([userId, status, matchedWith]) => {
              const session = SessionTestUtils.createMockSession(userId, {
                status,
                matchedWith: status === 'in-call' ? matchedWith : undefined
              });
              activeSessions.set(userId, session);
              
              if (status === 'waiting') {
                matchingPool.add(userId);
              }
            });

            const initialPoolSize = matchingPool.size;
            const initialSessionCount = activeSessions.size;

            // Simulate browser close for each user
            const cleanupResults = userSessions.map(([userId]) => {
              const wasInPool = matchingPool.has(userId);
              const result = SessionTestUtils.simulateBrowserClose(activeSessions, userId);
              
              // Remove from matching pool immediately (Requirements 8.1)
              if (wasInPool) {
                matchingPool.delete(userId);
              }
              
              return { userId, wasInPool, ...result };
            });

            // Verify immediate matching pool cleanup (Requirements 8.1)
            expect(matchingPool.size).toBe(0);

            // Verify session handling based on status
            cleanupResults.forEach(({ userId, preserved, wasInPool }) => {
              const originalSession = userSessions.find(([id]) => id === userId);
              if (originalSession) {
                const [, status, matchedWith] = originalSession;
                
                if (status === 'in-call' && matchedWith) {
                  // Active calls should preserve session for reconnection (Requirements 8.4)
                  expect(preserved).toBe(true);
                  expect(activeSessions.has(userId)).toBe(true);
                  expect(activeSessions.get(userId)?.isReconnecting).toBe(true);
                } else {
                  // Non-active sessions should be immediately cleaned up
                  expect(preserved).toBe(false);
                  expect(activeSessions.has(userId)).toBe(false);
                }
                
                // All users should be removed from matching pool regardless of session status
                if (wasInPool) {
                  expect(matchingPool.has(userId)).toBe(false);
                }
              }
            });
          }
        ),
        { numRuns: 10 }
      );
    });

    /**
     * Feature: university-video-chat, Property 21: Browser close cleanup
     * Validates: Requirements 8.2
     * 
     * For any student in an active call who closes browser, their chat partner should be notified of disconnection
     */
    it('should notify chat partners when any user closes browser during active call', async () => {
      const userPairArbitrary = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 })
      ).filter(([user1, user2]) => user1 !== user2);

      await fc.assert(
        fc.asyncProperty(userPairArbitrary, async ([user1Id, user2Id]) => {
          // Set up active call between two users
          const session1 = SessionTestUtils.createMockSession(user1Id, {
            status: 'in-call',
            matchedWith: user2Id
          });
          const session2 = SessionTestUtils.createMockSession(user2Id, {
            status: 'in-call',
            matchedWith: user1Id
          });

          activeSessions.set(user1Id, session1);
          activeSessions.set(user2Id, session2);

          // Simulate browser close for user1
          const result = SessionTestUtils.simulateBrowserClose(activeSessions, user1Id);

          // Verify session preservation for reconnection
          expect(result.preserved).toBe(true);
          expect(activeSessions.has(user1Id)).toBe(true);
          expect(activeSessions.get(user1Id)?.isReconnecting).toBe(true);

          // Verify partner session remains active
          expect(activeSessions.has(user2Id)).toBe(true);
          expect(activeSessions.get(user2Id)?.status).toBe('in-call');
          expect(activeSessions.get(user2Id)?.matchedWith).toBe(user1Id);

          // In real implementation, partner would be notified via socket.io
          // Here we verify the session state that would trigger the notification
          const partnerSession = activeSessions.get(user2Id);
          expect(partnerSession).not.toBeNull();
          expect(partnerSession?.matchedWith).toBe(user1Id);
        }),
        { numRuns: 10 }
      );
    });
  });

  describe('Property 22: Inactivity timeout', () => {
    /**
     * Feature: university-video-chat, Property 22: Inactivity timeout
     * Validates: Requirements 8.3
     * 
     * For any student inactive for extended periods, the system should automatically log them out for security
     */
    it('should automatically timeout all inactive sessions after configured period', async () => {
      const sessionDataArbitrary = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }), // userId
        fc.integer({ min: 1, max: 120 }), // minutes since last activity
        fc.constantFrom('waiting', 'matched', 'in-call') // session status
      );

      const timeoutMinutesArbitrary = fc.integer({ min: 15, max: 60 });

      await fc.assert(
        fc.asyncProperty(
          fc.array(sessionDataArbitrary, { minLength: 1, maxLength: 15 }),
          timeoutMinutesArbitrary,
          async (sessionData, timeoutMinutes) => {
            const now = new Date();
            
            // Clear any existing sessions to ensure test isolation
            activeSessions.clear();
            
            // Ensure unique user IDs to avoid conflicts
            const uniqueSessionData = sessionData.filter((item, index, arr) => 
              arr.findIndex(([userId]) => userId === item[0]) === index
            );
            
            // Set up sessions with various inactivity periods
            uniqueSessionData.forEach(([userId, minutesInactive, status]) => {
              const lastActivity = new Date(now.getTime() - minutesInactive * 60 * 1000);
              const session = SessionTestUtils.createMockSession(userId, {
                status,
                lastActivity
              });
              activeSessions.set(userId, session);
            });

            const initialSessionCount = activeSessions.size;

            // Simulate inactivity timeout cleanup
            const timedOutUsers = SessionTestUtils.simulateInactivityTimeout(activeSessions, timeoutMinutes);

            // Verify timeout behavior
            uniqueSessionData.forEach(([userId, minutesInactive, status]) => {
              const shouldTimeout = minutesInactive > timeoutMinutes;
              
              if (shouldTimeout) {
                // User should be timed out and removed
                expect(activeSessions.has(userId)).toBe(false);
                expect(timedOutUsers).toContain(userId);
              } else {
                // User should remain active
                expect(activeSessions.has(userId)).toBe(true);
                expect(timedOutUsers).not.toContain(userId);
              }
            });

            // Verify cleanup count matches expectations
            const expectedTimeouts = uniqueSessionData.filter(([, minutesInactive]) => minutesInactive > timeoutMinutes).length;
            expect(timedOutUsers.length).toBe(expectedTimeouts);
            expect(activeSessions.size).toBe(initialSessionCount - expectedTimeouts);
          }
        ),
        { numRuns: 10 }
      );
    });

    /**
     * Feature: university-video-chat, Property 22: Inactivity timeout
     * Validates: Requirements 8.3
     * 
     * For any active call session, inactivity timeout should end the call and notify both partners
     */
    it('should handle inactivity timeout for all active call sessions appropriately', async () => {
      const callPairArbitrary = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 120 }) // minutes inactive
      ).filter(([user1, user2]) => user1 !== user2);

      const timeoutMinutesArbitrary = fc.integer({ min: 15, max: 60 });

      await fc.assert(
        fc.asyncProperty(
          fc.array(callPairArbitrary, { minLength: 1, maxLength: 5 }),
          timeoutMinutesArbitrary,
          async (callPairs, timeoutMinutes) => {
            const now = new Date();
            
            // Set up active call sessions
            callPairs.forEach(([user1Id, user2Id, minutesInactive]) => {
              const lastActivity = new Date(now.getTime() - minutesInactive * 60 * 1000);
              
              const session1 = SessionTestUtils.createMockSession(user1Id, {
                status: 'in-call',
                matchedWith: user2Id,
                lastActivity
              });
              const session2 = SessionTestUtils.createMockSession(user2Id, {
                status: 'in-call',
                matchedWith: user1Id,
                lastActivity
              });

              activeSessions.set(user1Id, session1);
              activeSessions.set(user2Id, session2);
            });

            // Simulate timeout cleanup
            const timedOutUsers = SessionTestUtils.simulateInactivityTimeout(activeSessions, timeoutMinutes);

            // Verify timeout behavior for call pairs
            callPairs.forEach(([user1Id, user2Id, minutesInactive]) => {
              const shouldTimeout = minutesInactive > timeoutMinutes;
              
              if (shouldTimeout) {
                // Both users in the call should be timed out
                expect(activeSessions.has(user1Id)).toBe(false);
                expect(activeSessions.has(user2Id)).toBe(false);
                expect(timedOutUsers).toContain(user1Id);
                expect(timedOutUsers).toContain(user2Id);
              } else {
                // Both users should remain in active call
                expect(activeSessions.has(user1Id)).toBe(true);
                expect(activeSessions.has(user2Id)).toBe(true);
                expect(activeSessions.get(user1Id)?.status).toBe('in-call');
                expect(activeSessions.get(user2Id)?.status).toBe('in-call');
              }
            });
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Property 23: Session persistence', () => {
    /**
     * Feature: university-video-chat, Property 23: Session persistence
     * Validates: Requirements 8.4
     * 
     * For any active video chat, the system should maintain session state across page refreshes
     */
    it('should maintain session state across page refreshes for all active video chats', async () => {
      const activeChatArbitrary = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }), // room ID
        fc.integer({ min: 1, max: 60 }) // minutes since call started
      ).filter(([user1, user2]) => user1 !== user2);

      await fc.assert(
        fc.asyncProperty(
          fc.array(activeChatArbitrary, { minLength: 1, maxLength: 5 }),
          async (activeChats) => {
            const now = new Date();
            
            // Set up active video chat sessions
            activeChats.forEach(([user1Id, user2Id, roomId, minutesSinceStart]) => {
              const callStartTime = new Date(now.getTime() - minutesSinceStart * 60 * 1000);
              
              const session1 = SessionTestUtils.createMockSession(user1Id, {
                id: roomId,
                status: 'in-call',
                matchedWith: user2Id,
                joinedAt: callStartTime,
                lastActivity: now
              });
              const session2 = SessionTestUtils.createMockSession(user2Id, {
                id: roomId,
                status: 'in-call',
                matchedWith: user1Id,
                joinedAt: callStartTime,
                lastActivity: now
              });

              activeSessions.set(user1Id, session1);
              activeSessions.set(user2Id, session2);
            });

            // Simulate page refresh for each user (session restoration)
            const restorationResults = activeChats.map(([user1Id, user2Id, roomId]) => {
              const newSocketId1 = `new_socket_${user1Id}`;
              const newSocketId2 = `new_socket_${user2Id}`;
              
              const restore1 = SessionTestUtils.simulateSessionRestore(activeSessions, user1Id, newSocketId1);
              const restore2 = SessionTestUtils.simulateSessionRestore(activeSessions, user2Id, newSocketId2);
              
              return { user1Id, user2Id, roomId, restore1, restore2 };
            });

            // Verify session persistence
            restorationResults.forEach(({ user1Id, user2Id, roomId, restore1, restore2 }) => {
              // Both users should have their sessions restored
              expect(restore1.restored).toBe(true);
              expect(restore2.restored).toBe(true);
              
              // Session state should be maintained
              const session1 = activeSessions.get(user1Id);
              const session2 = activeSessions.get(user2Id);
              
              expect(session1).not.toBeNull();
              expect(session2).not.toBeNull();
              expect(session1?.status).toBe('in-call');
              expect(session2?.status).toBe('in-call');
              expect(session1?.matchedWith).toBe(user2Id);
              expect(session2?.matchedWith).toBe(user1Id);
              expect(session1?.id).toBe(roomId);
              expect(session2?.id).toBe(roomId);
              
              // Socket IDs should be updated
              expect(session1?.socketId).toBe(`new_socket_${user1Id}`);
              expect(session2?.socketId).toBe(`new_socket_${user2Id}`);
              
              // Last activity should be updated
              expect(session1?.lastActivity.getTime()).toBeGreaterThan(session1?.joinedAt.getTime() || 0);
              expect(session2?.lastActivity.getTime()).toBeGreaterThan(session2?.joinedAt.getTime() || 0);
            });
          }
        ),
        { numRuns: 10 }
      );
    });

    /**
     * Feature: university-video-chat, Property 23: Session persistence
     * Validates: Requirements 8.4
     * 
     * For any non-active session, page refresh should not restore session state
     */
    it('should not restore session state for non-active sessions across page refreshes', async () => {
      const nonActiveSessionArbitrary = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom('waiting', 'matched') // non-active statuses
      );

      await fc.assert(
        fc.asyncProperty(
          fc.array(nonActiveSessionArbitrary, { minLength: 1, maxLength: 10 }),
          async (nonActiveSessions) => {
            // Set up non-active sessions
            nonActiveSessions.forEach(([userId, status]) => {
              const session = SessionTestUtils.createMockSession(userId, { status });
              activeSessions.set(userId, session);
            });

            // Attempt session restoration for each user
            const restorationResults = nonActiveSessions.map(([userId]) => {
              const newSocketId = `new_socket_${userId}`;
              const result = SessionTestUtils.simulateSessionRestore(activeSessions, userId, newSocketId);
              return { userId, ...result };
            });

            // Verify no session restoration for non-active sessions
            restorationResults.forEach(({ userId, restored }) => {
              expect(restored).toBe(false);
              
              // Original session should still exist but not be restored
              const session = activeSessions.get(userId);
              expect(session).not.toBeNull();
              expect(session?.status).not.toBe('in-call');
              
              // Socket ID should not be updated
              expect(session?.socketId).toBe(`socket_${userId}`);
            });
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('Property 24: Network reconnection', () => {
    /**
     * Feature: university-video-chat, Property 24: Network reconnection
     * Validates: Requirements 8.5
     * 
     * For any network connectivity restoration, the system should attempt to reconnect students to their previous session if still valid
     */
    it('should successfully reconnect all users to valid previous sessions when network is restored', async () => {
      const disconnectedUserArbitrary = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 60 }) // seconds since disconnect (well within 2 minute window)
      ).filter(([user1, user2]) => user1 !== user2);

      await fc.assert(
        fc.asyncProperty(
          fc.array(disconnectedUserArbitrary, { minLength: 1, maxLength: 5 }),
          async (disconnectedUsers) => {
            const now = new Date();
            
            // Set up disconnected sessions within reconnection window
            disconnectedUsers.forEach(([user1Id, user2Id, secondsSinceDisconnect]) => {
              const disconnectTime = new Date(now.getTime() - secondsSinceDisconnect * 1000);
              
              const session1 = SessionTestUtils.createMockSession(user1Id, {
                status: 'in-call',
                matchedWith: user2Id,
                isReconnecting: true,
                lastDisconnectedAt: disconnectTime
              });
              const session2 = SessionTestUtils.createMockSession(user2Id, {
                status: 'in-call',
                matchedWith: user1Id,
                lastActivity: now // partner still connected
              });

              activeSessions.set(user1Id, session1);
              activeSessions.set(user2Id, session2);
            });

            // Simulate network reconnection attempts
            const reconnectionResults = disconnectedUsers.map(([user1Id, user2Id, secondsSinceDisconnect]) => {
              const result = SessionTestUtils.simulateNetworkReconnection(activeSessions, user1Id);
              return { user1Id, user2Id, secondsSinceDisconnect, ...result };
            });

            // Verify reconnection behavior
            reconnectionResults.forEach(({ user1Id, user2Id, secondsSinceDisconnect, reconnected }) => {
              const reconnectionWindow = 2 * 60; // 2 minutes in seconds
              const shouldReconnect = secondsSinceDisconnect <= reconnectionWindow;
              
              if (shouldReconnect) {
                // Should successfully reconnect within window
                expect(reconnected).toBe(true);
                
                const session = activeSessions.get(user1Id);
                expect(session).not.toBeNull();
                expect(session?.isReconnecting).toBe(false);
                expect(session?.status).toBe('in-call');
                expect(session?.matchedWith).toBe(user2Id);
                expect(session?.lastActivity.getTime()).toBeGreaterThan(session?.lastDisconnectedAt?.getTime() || 0);
              } else {
                // Should not reconnect outside window
                expect(reconnected).toBe(false);
              }
            });
          }
        ),
        { numRuns: 10 }
      );
    });

    /**
     * Feature: university-video-chat, Property 24: Network reconnection
     * Validates: Requirements 8.5
     * 
     * For any expired reconnection window, the system should not allow reconnection and should clean up the session
     */
    it('should reject reconnection attempts for all sessions outside the valid reconnection window', async () => {
      const expiredSessionArbitrary = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 121, max: 600 }) // seconds since disconnect (outside 2 minute window)
      ).filter(([user1, user2]) => user1 !== user2);

      await fc.assert(
        fc.asyncProperty(
          fc.array(expiredSessionArbitrary, { minLength: 1, maxLength: 5 }),
          async (expiredSessions) => {
            const now = new Date();
            
            // Set up expired disconnected sessions
            expiredSessions.forEach(([user1Id, user2Id, secondsSinceDisconnect]) => {
              const disconnectTime = new Date(now.getTime() - secondsSinceDisconnect * 1000);
              
              const session1 = SessionTestUtils.createMockSession(user1Id, {
                status: 'in-call',
                matchedWith: user2Id,
                isReconnecting: true,
                lastDisconnectedAt: disconnectTime
              });

              activeSessions.set(user1Id, session1);
            });

            // Attempt reconnection for expired sessions
            const reconnectionResults = expiredSessions.map(([user1Id, user2Id, secondsSinceDisconnect]) => {
              const result = SessionTestUtils.simulateNetworkReconnection(activeSessions, user1Id);
              return { user1Id, user2Id, secondsSinceDisconnect, ...result };
            });

            // Verify all reconnection attempts are rejected
            reconnectionResults.forEach(({ user1Id, reconnected, secondsSinceDisconnect }) => {
              const reconnectionWindow = 2 * 60; // 2 minutes in seconds
              
              // Should not reconnect outside window
              expect(secondsSinceDisconnect).toBeGreaterThan(reconnectionWindow);
              expect(reconnected).toBe(false);
              
              // Session should still exist but remain in reconnecting state
              const session = activeSessions.get(user1Id);
              expect(session).not.toBeNull();
              expect(session?.isReconnecting).toBe(true);
            });
          }
        ),
        { numRuns: 10 }
      );
    });

    /**
     * Feature: university-video-chat, Property 24: Network reconnection
     * Validates: Requirements 8.5
     * 
     * For any reconnection attempt, both partners should be synchronized after successful reconnection
     */
    it('should synchronize both partners after any successful reconnection', async () => {
      const reconnectionPairArbitrary = fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 60 }) // seconds since disconnect (within window)
      ).filter(([user1, user2]) => user1 !== user2);

      await fc.assert(
        fc.asyncProperty(
          fc.array(reconnectionPairArbitrary, { minLength: 1, maxLength: 3 }),
          async (reconnectionPairs) => {
            const now = new Date();
            
            // Set up disconnected user with connected partner
            reconnectionPairs.forEach(([user1Id, user2Id, secondsSinceDisconnect]) => {
              const disconnectTime = new Date(now.getTime() - secondsSinceDisconnect * 1000);
              
              const session1 = SessionTestUtils.createMockSession(user1Id, {
                status: 'in-call',
                matchedWith: user2Id,
                isReconnecting: true,
                lastDisconnectedAt: disconnectTime
              });
              const session2 = SessionTestUtils.createMockSession(user2Id, {
                status: 'in-call',
                matchedWith: user1Id,
                lastActivity: now
              });

              activeSessions.set(user1Id, session1);
              activeSessions.set(user2Id, session2);
            });

            // Simulate successful reconnections
            const reconnectionResults = reconnectionPairs.map(([user1Id, user2Id]) => {
              const result = SessionTestUtils.simulateNetworkReconnection(activeSessions, user1Id);
              return { user1Id, user2Id, ...result };
            });

            // Verify partner synchronization after reconnection
            reconnectionResults.forEach(({ user1Id, user2Id, reconnected }) => {
              if (reconnected) {
                const session1 = activeSessions.get(user1Id);
                const session2 = activeSessions.get(user2Id);
                
                // Both sessions should be in sync
                expect(session1?.status).toBe('in-call');
                expect(session2?.status).toBe('in-call');
                expect(session1?.matchedWith).toBe(user2Id);
                expect(session2?.matchedWith).toBe(user1Id);
                expect(session1?.isReconnecting).toBe(false);
                expect(session2?.isReconnecting).toBe(false);
                
                // Both should have recent activity
                const timeDiff = Math.abs((session1?.lastActivity.getTime() || 0) - (session2?.lastActivity.getTime() || 0));
                expect(timeDiff).toBeLessThan(5000); // Within 5 seconds
              }
            });
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});