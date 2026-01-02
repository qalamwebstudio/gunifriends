const jwt = require('jsonwebtoken');
const { MatchingService } = require('./matching-service');
const { WebRTCManager } = require('./webrtc-manager');

// Mock Socket.io functionality for testing
class MockSocket {
  constructor(userId, userEmail) {
    this.id = `socket_${userId}`;
    this.userId = userId;
    this.userEmail = userEmail;
    this.events = {};
    this.emittedEvents = [];
  }

  on(event, handler) {
    this.events[event] = handler;
  }

  emit(event, data) {
    this.emittedEvents.push({ event, data });
  }

  trigger(event, data) {
    if (this.events[event]) {
      this.events[event](data);
    }
  }
}

class MockIO {
  constructor() {
    this.sockets = new Map();
  }

  to(socketId) {
    return {
      emit: (event, data) => {
        const socket = Array.from(this.sockets.values()).find(s => s.id === socketId);
        if (socket) {
          socket.emit(event, data);
        }
      }
    };
  }
}

describe('Signaling Server Event Handlers', () => {
  let matchingService;
  let webrtcManager;
  let activeSessions;
  let matchingPool;
  let mockIO;
  let socket1;
  let socket2;

  const JWT_SECRET = 'test-secret-key';
  const user1 = { userId: 'user1', email: 'user1@test.edu', isEmailVerified: true };
  const user2 = { userId: 'user2', email: 'user2@test.edu', isEmailVerified: true };

  // Authentication middleware function
  const authenticateSocket = (socket, token) => {
    try {
      if (!token) {
        throw new Error('Authentication token required');
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      if (!decoded || !decoded.isEmailVerified) {
        throw new Error('Invalid or unverified token');
      }

      socket.userId = decoded.userId;
      socket.userEmail = decoded.email;
      return true;
    } catch (error) {
      return false;
    }
  };

  // Event handler functions (extracted from server.js logic)
  const createEventHandlers = (socket, io, matchingService, webrtcManager, activeSessions) => {
    return {
      handleConnection: () => {
        const session = {
          id: `session_${Date.now()}_${socket.userId}`,
          userId: socket.userId,
          socketId: socket.id,
          status: 'waiting',
          joinedAt: new Date(),
          lastActivity: new Date()
        };
        activeSessions.set(socket.userId, session);
      },

      handleJoinMatchingPool: () => {
        const added = matchingService.addToPool(socket.userId);
        if (!added) {
          socket.emit('error', 'Failed to join matching pool');
          return;
        }

        const partnerId = matchingService.findMatch(socket.userId);
        if (partnerId) {
          const match = matchingService.createMatch(socket.userId, partnerId);
          if (match) {
            webrtcManager.createConnection(match.id, socket.userId, partnerId);
            
            const partnerSession = activeSessions.get(partnerId);
            if (partnerSession) {
              socket.emit('match-found', { partnerId, roomId: match.id });
              io.to(partnerSession.socketId).emit('match-found', { 
                partnerId: socket.userId, 
                roomId: match.id 
              });
            }
          }
        }
      },

      handleLeaveMatchingPool: () => {
        matchingService.removeFromPool(socket.userId);
      },

      handleOffer: (offer) => {
        const session = activeSessions.get(socket.userId);
        if (!session || !session.matchedWith) {
          socket.emit('error', 'No active match to send offer to');
          return;
        }

        const partnerSession = activeSessions.get(session.matchedWith);
        if (!partnerSession) {
          socket.emit('error', 'Partner not found');
          return;
        }

        const connection = webrtcManager.getConnectionByUserId(socket.userId);
        if (connection) {
          webrtcManager.updateConnectionState(connection.id, 'connecting');
        }

        io.to(partnerSession.socketId).emit('offer', offer);
      },

      handleAnswer: (answer) => {
        const session = activeSessions.get(socket.userId);
        if (!session || !session.matchedWith) {
          socket.emit('error', 'No active match to send answer to');
          return;
        }

        const partnerSession = activeSessions.get(session.matchedWith);
        if (!partnerSession) {
          socket.emit('error', 'Partner not found');
          return;
        }

        io.to(partnerSession.socketId).emit('answer', answer);
        
        session.status = 'in-call';
        partnerSession.status = 'in-call';
        
        const connection = webrtcManager.getConnectionByUserId(socket.userId);
        if (connection) {
          webrtcManager.updateConnectionState(connection.id, 'connected');
        }
      },

      handleIceCandidate: (candidate) => {
        const session = activeSessions.get(socket.userId);
        if (!session || !session.matchedWith) {
          socket.emit('error', 'No active match to send ICE candidate to');
          return;
        }

        const partnerSession = activeSessions.get(session.matchedWith);
        if (!partnerSession) {
          socket.emit('error', 'Partner not found');
          return;
        }

        io.to(partnerSession.socketId).emit('ice-candidate', candidate);
      },

      handleEndCall: () => {
        const session = activeSessions.get(socket.userId);
        if (!session || !session.matchedWith) {
          socket.emit('error', 'No active call to end');
          return;
        }

        const partnerSession = activeSessions.get(session.matchedWith);
        const partnerId = session.matchedWith;

        const connection = webrtcManager.getConnectionByUserId(socket.userId);
        if (connection) {
          webrtcManager.updateConnectionState(connection.id, 'closed');
        }

        const match = matchingService.getMatchByUserId(socket.userId);
        if (match) {
          matchingService.endMatch(match.id, 'normal');
        }

        if (partnerSession) {
          io.to(partnerSession.socketId).emit('call-ended');
        }
        socket.emit('call-ended');
      },

      handleSkipUser: () => {
        const session = activeSessions.get(socket.userId);
        if (!session || !session.matchedWith) {
          socket.emit('error', 'No active match to skip');
          return;
        }

        const partnerSession = activeSessions.get(session.matchedWith);
        const match = matchingService.getMatchByUserId(socket.userId);
        
        if (match) {
          const connection = webrtcManager.getConnection(match.id);
          if (connection) {
            webrtcManager.updateConnectionState(connection.id, 'closed');
          }
          matchingService.endMatch(match.id, 'skip');
        }

        if (partnerSession) {
          io.to(partnerSession.socketId).emit('call-ended');
        }
        socket.emit('call-ended');
      },

      handleDisconnect: () => {
        const session = activeSessions.get(socket.userId);
        if (session) {
          matchingService.removeFromPool(socket.userId);
          
          if (session.status === 'in-call' && session.matchedWith) {
            const partnerSession = activeSessions.get(session.matchedWith);
            if (partnerSession) {
              io.to(partnerSession.socketId).emit('partner-disconnected');
              
              const connection = webrtcManager.getConnectionByUserId(socket.userId);
              if (connection) {
                webrtcManager.updateConnectionState(connection.id, 'disconnected');
              }
              
              const match = matchingService.getMatchByUserId(socket.userId);
              if (match) {
                matchingService.endMatch(match.id, 'disconnect');
              }
            }
          }
          
          activeSessions.delete(socket.userId);
        }
      }
    };
  };

  beforeEach(() => {
    // Initialize services
    matchingPool = new Set();
    activeSessions = new Map();
    matchingService = new MatchingService(matchingPool, activeSessions);
    webrtcManager = new WebRTCManager();
    mockIO = new MockIO();

    // Create mock sockets
    socket1 = new MockSocket(user1.userId, user1.email);
    socket2 = new MockSocket(user2.userId, user2.email);
    
    mockIO.sockets.set(socket1.id, socket1);
    mockIO.sockets.set(socket2.id, socket2);
  });

  describe('Authentication', () => {
    it('should reject connection without token', () => {
      const socket = new MockSocket('test', 'test@test.edu');
      const result = authenticateSocket(socket, null);
      expect(result).toBe(false);
    });

    it('should reject connection with invalid token', () => {
      const socket = new MockSocket('test', 'test@test.edu');
      const result = authenticateSocket(socket, 'invalid-token');
      expect(result).toBe(false);
    });

    it('should reject connection with unverified email', () => {
      const unverifiedUser = { userId: 'unverified', email: 'unverified@test.edu', isEmailVerified: false };
      const token = jwt.sign(unverifiedUser, JWT_SECRET);
      const socket = new MockSocket('test', 'test@test.edu');
      
      const result = authenticateSocket(socket, token);
      expect(result).toBe(false);
    });

    it('should accept connection with valid verified token', () => {
      const token = jwt.sign(user1, JWT_SECRET);
      const socket = new MockSocket('test', 'test@test.edu');
      
      const result = authenticateSocket(socket, token);
      expect(result).toBe(true);
      expect(socket.userId).toBe(user1.userId);
      expect(socket.userEmail).toBe(user1.email);
    });
  });

  describe('Connection Handling', () => {
    it('should create session on connection', () => {
      const handlers = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers.handleConnection();
      
      const session = activeSessions.get(user1.userId);
      expect(session).toBeDefined();
      expect(session.userId).toBe(user1.userId);
      expect(session.socketId).toBe(socket1.id);
      expect(session.status).toBe('waiting');
    });
  });

  describe('Matching Flow', () => {
    beforeEach(() => {
      // Set up sessions for both users
      const handlers1 = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      const handlers2 = createEventHandlers(socket2, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers1.handleConnection();
      handlers2.handleConnection();
    });

    it('should handle join-matching-pool event', () => {
      const handlers = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers.handleJoinMatchingPool();
      
      expect(matchingPool.has(user1.userId)).toBe(true);
      expect(activeSessions.get(user1.userId).status).toBe('waiting');
    });

    it('should match two users when both join pool', () => {
      const handlers1 = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      const handlers2 = createEventHandlers(socket2, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers1.handleJoinMatchingPool();
      handlers2.handleJoinMatchingPool();
      
      // Check that both users were matched
      expect(matchingPool.size).toBe(0); // Both users removed from pool
      expect(activeSessions.get(user1.userId).status).toBe('matched');
      expect(activeSessions.get(user2.userId).status).toBe('matched');
      
      // Check that match-found events were emitted
      const socket1Events = socket1.emittedEvents.filter(e => e.event === 'match-found');
      const socket2Events = socket2.emittedEvents.filter(e => e.event === 'match-found');
      
      expect(socket1Events.length).toBe(1);
      expect(socket2Events.length).toBe(1);
      expect(socket1Events[0].data.partnerId).toBe(user2.userId);
      expect(socket2Events[0].data.partnerId).toBe(user1.userId);
    });

    it('should handle leave-matching-pool event', () => {
      const handlers = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers.handleJoinMatchingPool();
      expect(matchingPool.has(user1.userId)).toBe(true);
      
      handlers.handleLeaveMatchingPool();
      expect(matchingPool.has(user1.userId)).toBe(false);
    });

    it('should emit error when joining pool fails', () => {
      // Remove session to simulate failure condition
      activeSessions.delete(user1.userId);
      
      const handlers = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      handlers.handleJoinMatchingPool();
      
      const errorEvents = socket1.emittedEvents.filter(e => e.event === 'error');
      expect(errorEvents.length).toBe(1);
      expect(errorEvents[0].data).toBe('Failed to join matching pool');
    });
  });

  describe('WebRTC Signaling Flow', () => {
    beforeEach(() => {
      // Set up a match between the two users
      const handlers1 = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      const handlers2 = createEventHandlers(socket2, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers1.handleConnection();
      handlers2.handleConnection();
      handlers1.handleJoinMatchingPool();
      handlers2.handleJoinMatchingPool();
      
      // Clear emitted events from matching
      socket1.emittedEvents = [];
      socket2.emittedEvents = [];
    });

    it('should forward offer from user1 to user2', () => {
      const testOffer = { type: 'offer', sdp: 'test-sdp-offer' };
      const handlers = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers.handleOffer(testOffer);
      
      // Check that offer was forwarded to partner
      const socket2Events = socket2.emittedEvents.filter(e => e.event === 'offer');
      expect(socket2Events.length).toBe(1);
      expect(socket2Events[0].data).toEqual(testOffer);
      
      // Check that WebRTC connection state was updated
      const connection = webrtcManager.getConnectionByUserId(user1.userId);
      expect(connection.state).toBe('connecting');
    });

    it('should forward answer from user2 to user1', () => {
      const testAnswer = { type: 'answer', sdp: 'test-sdp-answer' };
      const handlers = createEventHandlers(socket2, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers.handleAnswer(testAnswer);
      
      // Check that answer was forwarded to partner
      const socket1Events = socket1.emittedEvents.filter(e => e.event === 'answer');
      expect(socket1Events.length).toBe(1);
      expect(socket1Events[0].data).toEqual(testAnswer);
      
      // Check that both sessions are now in-call
      expect(activeSessions.get(user1.userId).status).toBe('in-call');
      expect(activeSessions.get(user2.userId).status).toBe('in-call');
      
      // Check that WebRTC connection state was updated
      const connection = webrtcManager.getConnectionByUserId(user2.userId);
      expect(connection.state).toBe('connected');
    });

    it('should forward ICE candidates between users', () => {
      const testCandidate = { candidate: 'test-ice-candidate', sdpMid: 'test' };
      const handlers = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers.handleIceCandidate(testCandidate);
      
      // Check that ICE candidate was forwarded to partner
      const socket2Events = socket2.emittedEvents.filter(e => e.event === 'ice-candidate');
      expect(socket2Events.length).toBe(1);
      expect(socket2Events[0].data).toEqual(testCandidate);
    });

    it('should emit error when sending offer without active match', () => {
      // Create a user without a match
      const socket3 = new MockSocket('user3', 'user3@test.edu');
      const handlers = createEventHandlers(socket3, mockIO, matchingService, webrtcManager, activeSessions);
      handlers.handleConnection();
      
      handlers.handleOffer({ type: 'offer', sdp: 'test' });
      
      const errorEvents = socket3.emittedEvents.filter(e => e.event === 'error');
      expect(errorEvents.length).toBe(1);
      expect(errorEvents[0].data).toBe('No active match to send offer to');
    });

    it('should emit error when sending answer without active match', () => {
      // Create a user without a match
      const socket3 = new MockSocket('user3', 'user3@test.edu');
      const handlers = createEventHandlers(socket3, mockIO, matchingService, webrtcManager, activeSessions);
      handlers.handleConnection();
      
      handlers.handleAnswer({ type: 'answer', sdp: 'test' });
      
      const errorEvents = socket3.emittedEvents.filter(e => e.event === 'error');
      expect(errorEvents.length).toBe(1);
      expect(errorEvents[0].data).toBe('No active match to send answer to');
    });

    it('should emit error when sending ICE candidate without active match', () => {
      // Create a user without a match
      const socket3 = new MockSocket('user3', 'user3@test.edu');
      const handlers = createEventHandlers(socket3, mockIO, matchingService, webrtcManager, activeSessions);
      handlers.handleConnection();
      
      handlers.handleIceCandidate({ candidate: 'test' });
      
      const errorEvents = socket3.emittedEvents.filter(e => e.event === 'error');
      expect(errorEvents.length).toBe(1);
      expect(errorEvents[0].data).toBe('No active match to send ICE candidate to');
    });
  });

  describe('Call Management', () => {
    beforeEach(() => {
      // Set up a match and simulate in-call state
      const handlers1 = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      const handlers2 = createEventHandlers(socket2, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers1.handleConnection();
      handlers2.handleConnection();
      handlers1.handleJoinMatchingPool();
      handlers2.handleJoinMatchingPool();
      
      // Simulate answer exchange to get to in-call state
      activeSessions.get(user1.userId).status = 'in-call';
      activeSessions.get(user2.userId).status = 'in-call';
      
      // Clear emitted events from matching
      socket1.emittedEvents = [];
      socket2.emittedEvents = [];
    });

    it('should handle end-call event and notify both users', () => {
      const handlers = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers.handleEndCall();
      
      // Check that call-ended events were emitted to both users
      const socket1Events = socket1.emittedEvents.filter(e => e.event === 'call-ended');
      const socket2Events = socket2.emittedEvents.filter(e => e.event === 'call-ended');
      
      expect(socket1Events.length).toBe(1);
      expect(socket2Events.length).toBe(1);
      
      // Check that match was ended
      const match = matchingService.getMatchByUserId(user1.userId);
      expect(match).toBeNull();
      
      // Check that sessions were reset
      expect(activeSessions.get(user1.userId).status).toBe('waiting');
      expect(activeSessions.get(user2.userId).status).toBe('waiting');
      
      // Check that WebRTC connection was closed
      const connection = webrtcManager.getConnectionByUserId(user1.userId);
      expect(connection.state).toBe('closed');
    });

    it('should handle skip-user event and end current match', () => {
      const handlers = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers.handleSkipUser();
      
      // Check that call-ended events were emitted to both users
      const socket1Events = socket1.emittedEvents.filter(e => e.event === 'call-ended');
      const socket2Events = socket2.emittedEvents.filter(e => e.event === 'call-ended');
      
      expect(socket1Events.length).toBe(1);
      expect(socket2Events.length).toBe(1);
      
      // Check that match was ended with skip reason
      const match = matchingService.getMatchByUserId(user1.userId);
      expect(match).toBeNull();
    });

    it('should emit error when ending call without active match', () => {
      // Create a user without a match
      const socket3 = new MockSocket('user3', 'user3@test.edu');
      const handlers = createEventHandlers(socket3, mockIO, matchingService, webrtcManager, activeSessions);
      handlers.handleConnection();
      
      handlers.handleEndCall();
      
      const errorEvents = socket3.emittedEvents.filter(e => e.event === 'error');
      expect(errorEvents.length).toBe(1);
      expect(errorEvents[0].data).toBe('No active call to end');
    });

    it('should emit error when skipping without active match', () => {
      // Create a user without a match
      const socket3 = new MockSocket('user3', 'user3@test.edu');
      const handlers = createEventHandlers(socket3, mockIO, matchingService, webrtcManager, activeSessions);
      handlers.handleConnection();
      
      handlers.handleSkipUser();
      
      const errorEvents = socket3.emittedEvents.filter(e => e.event === 'error');
      expect(errorEvents.length).toBe(1);
      expect(errorEvents[0].data).toBe('No active match to skip');
    });
  });

  describe('Disconnection Handling', () => {
    it('should clean up session and notify partner on disconnect', () => {
      // Set up a match first
      const handlers1 = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      const handlers2 = createEventHandlers(socket2, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers1.handleConnection();
      handlers2.handleConnection();
      handlers1.handleJoinMatchingPool();
      handlers2.handleJoinMatchingPool();
      
      // Simulate in-call state
      activeSessions.get(user1.userId).status = 'in-call';
      activeSessions.get(user2.userId).status = 'in-call';
      
      // Clear emitted events from matching
      socket2.emittedEvents = [];
      
      // Disconnect user1
      handlers1.handleDisconnect();
      
      // Check that user1's session was cleaned up
      expect(activeSessions.has(user1.userId)).toBe(false);
      
      // Check that partner was notified
      const socket2Events = socket2.emittedEvents.filter(e => e.event === 'partner-disconnected');
      expect(socket2Events.length).toBe(1);
      
      // Check that match was ended
      const match = matchingService.getMatchByUserId(user2.userId);
      expect(match).toBeNull();
      
      // Check that WebRTC connection was marked as disconnected
      const connection = webrtcManager.getConnectionByUserId(user2.userId);
      expect(connection.state).toBe('disconnected');
    });

    it('should remove user from matching pool on disconnect', () => {
      const handlers = createEventHandlers(socket1, mockIO, matchingService, webrtcManager, activeSessions);
      
      handlers.handleConnection();
      handlers.handleJoinMatchingPool();
      
      expect(matchingPool.has(user1.userId)).toBe(true);
      expect(activeSessions.has(user1.userId)).toBe(true);
      
      handlers.handleDisconnect();
      
      expect(matchingPool.has(user1.userId)).toBe(false);
      expect(activeSessions.has(user1.userId)).toBe(false);
    });
  });
});