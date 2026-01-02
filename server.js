const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server: SocketIOServer } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// In-memory stores (in production, use Redis or database)
const activeSessions = new Map();
const matchingPool = new Set();

// Import services
const { MatchingService } = require('./lib/matching-service');
const { WebRTCManager } = require('./lib/webrtc-manager');

/**
 * Authentication middleware for Socket.io connections
 */
function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    // Import JWT verification (we'll need to handle this differently in server.js)
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded) {
      return next(new Error('Invalid authentication token'));
    }

    if (!decoded.isEmailVerified) {
      return next(new Error('Email verification required'));
    }

    // Attach user data to socket
    socket.userId = decoded.userId;
    socket.userEmail = decoded.email;
    
    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // Initialize Socket.io server
  const io = new SocketIOServer(server, {
    cors: {
      origin: dev ? 'http://localhost:3000' : process.env.FRONTEND_URL,
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Initialize services
  const matchingService = new MatchingService(matchingPool, activeSessions);
  const webrtcManager = new WebRTCManager();

  // Apply authentication middleware
  io.use(authenticateSocket);

  // Handle client connections with enhanced session monitoring
  io.on('connection', (socket) => {
    console.log(`User ${socket.userId} connected with socket ${socket.id}`);

    // Create or update session for connected user (Requirements 8.4 - session persistence)
    const existingSession = activeSessions.get(socket.userId);
    const session = {
      id: existingSession?.id || `session_${Date.now()}_${socket.userId}`,
      userId: socket.userId,
      socketId: socket.id,
      status: existingSession?.status || 'waiting',
      matchedWith: existingSession?.matchedWith,
      joinedAt: existingSession?.joinedAt || new Date(),
      lastActivity: new Date(),
      // Add session persistence data (Requirements 8.4)
      reconnectionAttempts: existingSession?.reconnectionAttempts || 0,
      lastDisconnectedAt: existingSession?.lastDisconnectedAt,
      isReconnecting: false
    };
    
    activeSessions.set(socket.userId, session);

    // Handle session restoration for reconnecting users (Requirements 8.5)
    if (existingSession && existingSession.status === 'in-call' && existingSession.matchedWith) {
      console.log(`User ${socket.userId} reconnecting to active session with ${existingSession.matchedWith}`);
      
      // Notify the user about session restoration
      socket.emit('session-restored', {
        partnerId: existingSession.matchedWith,
        roomId: existingSession.id,
        wasReconnected: true
      });

      // Notify partner about reconnection
      const partnerSession = activeSessions.get(existingSession.matchedWith);
      if (partnerSession) {
        io.to(partnerSession.socketId).emit('partner-reconnected', {
          partnerId: socket.userId
        });
      }
    }

    // Set up heartbeat monitoring for browser close detection
    let heartbeatTimeout;
    
    const resetHeartbeat = () => {
      clearTimeout(heartbeatTimeout);
      heartbeatTimeout = setTimeout(() => {
        console.log(`Heartbeat timeout for user ${socket.userId}, assuming browser closed`);
        socket.disconnect(true);
      }, (HEARTBEAT_INTERVAL_SECONDS + 10) * 1000); // 10 second grace period
    };

    // Start heartbeat monitoring
    resetHeartbeat();

    // Handle heartbeat from client (Requirements 8.1 - browser close detection)
    socket.on('heartbeat', () => {
      resetHeartbeat();
      const session = activeSessions.get(socket.userId);
      if (session) {
        session.lastActivity = new Date();
      }
    });

    // Handle beforeunload event from client (browser close detection)
    socket.on('browser-closing', () => {
      console.log(`Browser closing detected for user ${socket.userId}`);
      // Trigger immediate disconnect handling
      socket.disconnect(true);
    });

    // Handle session restoration requests (Requirements 8.4, 8.5)
    socket.on('request-session-restore', () => {
      const session = activeSessions.get(socket.userId);
      if (session && session.status === 'in-call' && session.matchedWith) {
        console.log(`Session restoration requested for user ${socket.userId}`);
        
        // Update session with new socket ID
        session.socketId = socket.id;
        session.isReconnecting = false;
        session.lastActivity = new Date();
        
        // Send session restoration data
        socket.emit('session-restored', {
          partnerId: session.matchedWith,
          roomId: session.id,
          wasReconnected: true
        });
        
        // Notify partner of successful reconnection
        const partnerSession = activeSessions.get(session.matchedWith);
        if (partnerSession) {
          io.to(partnerSession.socketId).emit('partner-reconnected', {
            partnerId: socket.userId
          });
        }
      } else {
        socket.emit('session-restore-failed', {
          reason: 'No active session found'
        });
      }
    });

    // Basic event handlers (placeholders for now)
    socket.on('join-matching-pool', () => {
      console.log(`User ${socket.userId} joining matching pool`);
      
      // Add user to matching pool
      const added = matchingService.addToPool(socket.userId);
      if (!added) {
        socket.emit('error', 'Failed to join matching pool');
        return;
      }

      // Try to find a match immediately
      const partnerId = matchingService.findMatch(socket.userId);
      if (partnerId) {
        // Create match
        const match = matchingService.createMatch(socket.userId, partnerId);
        if (match) {
          // Create WebRTC connection tracking
          webrtcManager.createConnection(match.id, socket.userId, partnerId);
          
          // Notify both users of the match
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
      // If no match found, user stays in pool waiting
    });

    socket.on('leave-matching-pool', () => {
      console.log(`User ${socket.userId} leaving matching pool`);
      matchingService.removeFromPool(socket.userId);
    });

    socket.on('offer', (offer) => {
      console.log(`User ${socket.userId} sending offer`);
      
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

      // Update WebRTC connection state
      const connection = webrtcManager.getConnectionByUserId(socket.userId);
      if (connection) {
        webrtcManager.updateConnectionState(connection.id, 'connecting');
      }

      // Forward offer to partner
      io.to(partnerSession.socketId).emit('offer', offer);
      console.log(`Offer forwarded from ${socket.userId} to ${session.matchedWith}`);
    });

    socket.on('answer', (answer) => {
      console.log(`User ${socket.userId} sending answer`);
      
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

      // Forward answer to partner
      io.to(partnerSession.socketId).emit('answer', answer);
      
      // Update both sessions to 'in-call' status
      session.status = 'in-call';
      partnerSession.status = 'in-call';
      
      // Update WebRTC connection state to connected
      const connection = webrtcManager.getConnectionByUserId(socket.userId);
      if (connection) {
        webrtcManager.updateConnectionState(connection.id, 'connected');
      }
      
      console.log(`Answer forwarded from ${socket.userId} to ${session.matchedWith}`);
      console.log(`Both users now in call: ${socket.userId} <-> ${session.matchedWith}`);
    });

    socket.on('ice-candidate', (candidate) => {
      console.log(`User ${socket.userId} sending ICE candidate`);
      
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

      // Forward ICE candidate to partner
      io.to(partnerSession.socketId).emit('ice-candidate', candidate);
      console.log(`ICE candidate forwarded from ${socket.userId} to ${session.matchedWith}`);
    });

    socket.on('end-call', () => {
      console.log(`User ${socket.userId} ending call`);
      
      const session = activeSessions.get(socket.userId);
      if (!session || !session.matchedWith) {
        socket.emit('error', 'No active call to end');
        return;
      }

      const partnerSession = activeSessions.get(session.matchedWith);
      const partnerId = session.matchedWith;

      // Update WebRTC connection state
      const connection = webrtcManager.getConnectionByUserId(socket.userId);
      if (connection) {
        webrtcManager.updateConnectionState(connection.id, 'closed');
      }

      // End the match
      const match = matchingService.getMatchByUserId(socket.userId);
      if (match) {
        matchingService.endMatch(match.id, 'normal');
      }

      // Notify partner that call ended
      if (partnerSession) {
        io.to(partnerSession.socketId).emit('call-ended');
      }

      // Notify current user that call ended
      socket.emit('call-ended');
      
      console.log(`Call ended between ${socket.userId} and ${partnerId}`);
    });

    socket.on('report-user', (data) => {
      console.log(`User ${socket.userId} reporting user ${data.reportedUserId}`);
      
      const session = activeSessions.get(socket.userId);
      if (!session || !session.matchedWith) {
        socket.emit('error', 'No active match to report');
        return;
      }

      // Verify that the reported user is the current match partner
      if (session.matchedWith !== data.reportedUserId) {
        socket.emit('error', 'Can only report current match partner');
        return;
      }

      const partnerSession = activeSessions.get(data.reportedUserId);
      const partnerId = session.matchedWith;

      // Update WebRTC connection state
      const connection = webrtcManager.getConnectionByUserId(socket.userId);
      if (connection) {
        webrtcManager.updateConnectionState(connection.id, 'closed');
      }

      // End the match with report reason
      const match = matchingService.getMatchByUserId(socket.userId);
      if (match) {
        matchingService.endMatch(match.id, 'report');
      }

      // Immediately terminate the session for both users
      if (partnerSession) {
        io.to(partnerSession.socketId).emit('call-ended');
      }
      socket.emit('call-ended');

      console.log(`Report processed: ${socket.userId} reported ${partnerId} for ${data.category}`);
      console.log(`Session immediately terminated due to report`);
    });

    socket.on('skip-user', () => {
      console.log(`User ${socket.userId} skipping current match`);
      
      const session = activeSessions.get(socket.userId);
      if (!session || !session.matchedWith) {
        socket.emit('error', 'No active match to skip');
        return;
      }

      const partnerSession = activeSessions.get(session.matchedWith);
      const partnerId = session.matchedWith;

      // End the current match
      const match = matchingService.getMatchByUserId(socket.userId);
      if (match) {
        // Update WebRTC connection state
        const connection = webrtcManager.getConnection(match.id);
        if (connection) {
          webrtcManager.updateConnectionState(connection.id, 'closed');
        }
        
        matchingService.endMatch(match.id, 'skip');
      }

      // Notify partner that user skipped
      if (partnerSession) {
        io.to(partnerSession.socketId).emit('call-ended');
      }

      // Notify current user that skip was successful
      socket.emit('call-ended');

      // Automatically add user back to matching pool to find new match
      setTimeout(() => {
        const added = matchingService.addToPool(socket.userId);
        if (added) {
          const newPartnerId = matchingService.findMatch(socket.userId);
          if (newPartnerId) {
            const newMatch = matchingService.createMatch(socket.userId, newPartnerId);
            if (newMatch) {
              // Create WebRTC connection tracking for new match
              webrtcManager.createConnection(newMatch.id, socket.userId, newPartnerId);
              
              const newPartnerSession = activeSessions.get(newPartnerId);
              if (newPartnerSession) {
                socket.emit('match-found', { partnerId: newPartnerId, roomId: newMatch.id });
                io.to(newPartnerSession.socketId).emit('match-found', { 
                  partnerId: socket.userId, 
                  roomId: newMatch.id 
                });
              }
            }
          }
        }
      }, 1000); // Small delay to allow cleanup

      console.log(`User ${socket.userId} skipped match with ${partnerId}`);
    });

    // Enhanced disconnect handler with session persistence (Requirements 8.4, 8.5)
    socket.on('disconnect', (reason) => {
      clearTimeout(heartbeatTimeout);
      console.log(`User ${socket.userId} disconnected: ${reason}`);
      
      const session = activeSessions.get(socket.userId);
      if (session) {
        // Graceful disconnection handling (Requirements 8.5)
        session.lastDisconnectedAt = new Date();
        session.reconnectionAttempts = (session.reconnectionAttempts || 0) + 1;
        
        // For active calls, preserve session for reconnection (Requirements 8.4)
        if (session.status === 'in-call' && session.matchedWith) {
          console.log(`Preserving session for user ${socket.userId} in active call for potential reconnection`);
          
          // Mark as disconnected but don't remove session immediately
          session.isReconnecting = true;
          
          const partnerSession = activeSessions.get(session.matchedWith);
          if (partnerSession) {
            // Notify partner of temporary disconnection
            io.to(partnerSession.socketId).emit('partner-temporarily-disconnected', {
              partnerId: socket.userId,
              reason: reason
            });
          }
          
          // Set a timer to clean up if user doesn't reconnect within 2 minutes
          setTimeout(() => {
            const currentSession = activeSessions.get(socket.userId);
            if (currentSession && currentSession.isReconnecting) {
              console.log(`User ${socket.userId} did not reconnect within timeout, ending session`);
              
              // Remove from matching pool
              matchingService.removeFromPool(socket.userId);
              
              // End the match
              const match = matchingService.getMatchByUserId(socket.userId);
              if (match) {
                matchingService.endMatch(match.id, 'disconnect');
                
                // Update WebRTC connection state
                const connection = webrtcManager.getConnectionByUserId(socket.userId);
                if (connection) {
                  webrtcManager.updateConnectionState(connection.id, 'disconnected');
                }
              }
              
              // Notify partner of permanent disconnection
              if (currentSession.matchedWith) {
                const partnerSession = activeSessions.get(currentSession.matchedWith);
                if (partnerSession) {
                  io.to(partnerSession.socketId).emit('partner-disconnected');
                }
              }
              
              // Remove session
              activeSessions.delete(socket.userId);
            }
          }, 2 * 60 * 1000); // 2 minutes reconnection window
          
        } else {
          // For non-active sessions, immediate cleanup
          matchingService.removeFromPool(socket.userId);
          activeSessions.delete(socket.userId);
          console.log(`Immediate cleanup completed for user ${socket.userId} (${reason})`);
        }
      }
    });

    // Update last activity on any event
    socket.onAny(() => {
      const session = activeSessions.get(socket.userId);
      if (session) {
        session.lastActivity = new Date();
      }
    });
  });

  // Make services available globally for other modules
  global.io = io;
  global.activeSessions = activeSessions;
  global.matchingPool = matchingPool;
  global.matchingService = matchingService;
  global.webrtcManager = webrtcManager;

  // Session timeout configuration (Requirements 8.3)
  const SESSION_TIMEOUT_MINUTES = 30; // Inactive session timeout
  const CLEANUP_INTERVAL_MINUTES = 5; // How often to run cleanup
  const HEARTBEAT_INTERVAL_SECONDS = 30; // Client heartbeat interval

  // Enhanced session cleanup and monitoring
  const sessionCleanupInterval = setInterval(() => {
    const now = new Date();
    let cleanedSessions = 0;
    let cleanedConnections = 0;

    // Clean up inactive sessions (Requirements 8.3)
    for (const [userId, session] of activeSessions.entries()) {
      const inactiveTime = now.getTime() - session.lastActivity.getTime();
      const timeoutMs = SESSION_TIMEOUT_MINUTES * 60 * 1000;

      if (inactiveTime > timeoutMs) {
        console.log(`Session timeout for user ${userId} after ${Math.floor(inactiveTime / 60000)} minutes`);
        
        // Remove from matching pool if present
        matchingService.removeFromPool(userId);
        
        // Handle active match cleanup
        if (session.status === 'in-call' && session.matchedWith) {
          const partnerSession = activeSessions.get(session.matchedWith);
          if (partnerSession) {
            // Notify partner of timeout disconnection
            io.to(partnerSession.socketId).emit('partner-timeout');
            
            // End the match
            const match = matchingService.getMatchByUserId(userId);
            if (match) {
              matchingService.endMatch(match.id, 'timeout');
              webrtcManager.updateConnectionState(match.id, 'closed');
            }
          }
        }
        
        // Disconnect the socket if still connected
        const socketToDisconnect = io.sockets.sockets.get(session.socketId);
        if (socketToDisconnect) {
          socketToDisconnect.emit('session-timeout');
          socketToDisconnect.disconnect(true);
        }
        
        // Remove session
        activeSessions.delete(userId);
        cleanedSessions++;
      }
    }

    // Clean up old WebRTC connections
    cleanedConnections = webrtcManager.cleanupOldConnections(60); // 60 minutes timeout
    
    if (cleanedSessions > 0 || cleanedConnections > 0) {
      console.log(`Session cleanup: ${cleanedSessions} inactive sessions, ${cleanedConnections} old connections`);
    }
  }, CLEANUP_INTERVAL_MINUTES * 60 * 1000);

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log('> Socket.io server initialized');
  });
});