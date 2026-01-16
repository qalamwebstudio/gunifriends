const { Server } = require('socket.io');
const { createServer } = require('http');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Import connection configuration
const { CONNECTION_CONFIG, getSessionTimeout } = require('./connection-config');

// Configuration
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const MONGODB_URI = process.env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || 'university_video_chat';

// CORS configuration
const CORS_ORIGINS = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:3000', 'https://gunifriends.vercel.app'];

console.log('🚀 Starting Socket.io Server...');
console.log('📍 Port:', PORT);
console.log('🌐 CORS Origins:', CORS_ORIGINS);

// Create HTTP server
const server = createServer();

// Create Socket.io server with CORS and updated configuration
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: CONNECTION_CONFIG.socketPingTimeout, // Updated: 60s ping timeout
  pingInterval: CONNECTION_CONFIG.socketPingInterval // Updated: 25s ping interval
});

// MongoDB connection
let db = null;
let users = null;
let sessions = null;

async function connectToDatabase() {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI environment variable is not set');
    process.exit(1);
  }

  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DATABASE_NAME);
    users = db.collection('users');
    sessions = db.collection('sessions');
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

// In-memory storage for active sessions and matching pool
const activeSessions = new Map();
const matchingPool = new Set();

// JWT Authentication middleware
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('No token provided'));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await users.findOne({ id: decoded.userId });
    
    if (!user) {
      return next(new Error('User not found'));
    }

    socket.userId = user.id;
    socket.userEmail = user.email;
    socket.university = user.university;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    next(new Error('Authentication failed'));
  }
};

// Use authentication middleware
io.use(authenticateSocket);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.userEmail} (${socket.id})`);

  // Check if user already has an active session
  const existingSession = activeSessions.get(socket.userId);
  
  if (existingSession) {
    // Update existing session with new socket ID and enhanced fields for connection persistence
    console.log(`🔄 Updating socket ID for ${socket.userEmail}: ${existingSession.socketId} → ${socket.id}`);
    existingSession.socketId = socket.id;
    existingSession.connectedAt = new Date();
    existingSession.lastActivity = new Date();
    existingSession.lastHeartbeat = new Date();
    // Preserve existing isInActiveCall status and other fields
    if (!existingSession.hasOwnProperty('isInActiveCall')) {
      existingSession.isInActiveCall = false;
    }
    if (!existingSession.hasOwnProperty('connectionQuality')) {
      existingSession.connectionQuality = 'good';
    }
    if (!existingSession.hasOwnProperty('isVisible')) {
      existingSession.isVisible = true; // Default to visible on reconnection
    }
    if (!existingSession.hasOwnProperty('isOnline')) {
      existingSession.isOnline = true; // Default to online on socket connection
    }
    activeSessions.set(socket.userId, existingSession);
  } else {
    // Create new session with enhanced fields for connection persistence
    activeSessions.set(socket.userId, {
      socketId: socket.id,
      userId: socket.userId,
      email: socket.userEmail,
      university: socket.university,
      status: 'connected',
      connectedAt: new Date(),
      lastActivity: new Date(),
      lastHeartbeat: new Date(),
      connectionQuality: 'good',
      isInActiveCall: false,
      isVisible: true, // Track tab visibility (Requirements 5.2)
      isOnline: true   // Track network status (Requirements 5.1, 5.3)
    });
  }

  // Handle joining matching pool
  socket.on('join-matching-pool', () => {
    console.log(`🔍 ${socket.userEmail} joined matching pool`);
    
    // Add to matching pool
    matchingPool.add(socket.userId);
    
    // Update session status
    const session = activeSessions.get(socket.userId);
    if (session) {
      session.status = 'searching';
      activeSessions.set(socket.userId, session);
    }

    // Try to find a match
    findMatch(socket.userId);
  });

  // Handle leaving matching pool
  socket.on('leave-matching-pool', () => {
    console.log(`❌ ${socket.userEmail} left matching pool`);
    
    matchingPool.delete(socket.userId);
    
    // Update session status
    const session = activeSessions.get(socket.userId);
    if (session) {
      session.status = 'connected';
      activeSessions.set(socket.userId, session);
    }
  });

  // Handle WebRTC signaling with better error handling
  socket.on('offer', (data) => {
    console.log(`📤 Offer received from ${socket.userEmail} (${socket.id})`);
    const session = activeSessions.get(socket.userId);
    
    if (!session) {
      console.log(`❌ No session found for user ${socket.userEmail}`);
      socket.emit('error', 'User session not found');
      return;
    }
    
    if (!session.partnerId) {
      console.log(`❌ No partner ID in session for ${socket.userEmail}. Session:`, session);
      socket.emit('error', 'No partner assigned to session');
      return;
    }
    
    const partnerSession = activeSessions.get(session.partnerId);
    if (!partnerSession) {
      console.log(`❌ Partner session not found for offer from ${socket.userEmail}. Partner ID: ${session.partnerId}`);
      console.log(`📊 Active sessions:`, Array.from(activeSessions.keys()));
      console.log(`📊 Session details:`, session);
      socket.emit('error', 'Partner session not found');
      return;
    }
    
    if (!partnerSession.socketId) {
      console.log(`❌ Partner session has no socket ID for ${socket.userEmail}. Partner session:`, partnerSession);
      socket.emit('error', 'Partner not connected');
      return;
    }
    
    console.log(`📨 Forwarding offer to ${partnerSession.email} (${partnerSession.socketId})`);
    
    // Ensure the partner socket is still connected
    const partnerSocket = io.sockets.sockets.get(partnerSession.socketId);
    if (partnerSocket && partnerSocket.connected) {
      partnerSocket.emit('offer', data);
      console.log(`✅ Offer forwarded successfully to ${partnerSession.email}`);
    } else {
      console.log(`❌ Partner socket not connected for offer from ${socket.userEmail}`);
      socket.emit('error', 'Partner is not connected');
    }
  });

  socket.on('answer', (data) => {
    console.log(`📤 Answer received from ${socket.userEmail} (${socket.id})`);
    const session = activeSessions.get(socket.userId);
    
    if (!session) {
      console.log(`❌ No session found for user ${socket.userEmail}`);
      socket.emit('error', 'User session not found');
      return;
    }
    
    if (!session.partnerId) {
      console.log(`❌ No partner ID in session for ${socket.userEmail}`);
      socket.emit('error', 'No partner assigned to session');
      return;
    }
    
    const partnerSession = activeSessions.get(session.partnerId);
    if (!partnerSession) {
      console.log(`❌ Partner session not found for answer from ${socket.userEmail}. Partner ID: ${session.partnerId}`);
      console.log(`📊 Active sessions:`, Array.from(activeSessions.keys()));
      socket.emit('error', 'Partner session not found');
      return;
    }
    
    if (!partnerSession.socketId) {
      console.log(`❌ Partner session has no socket ID for ${socket.userEmail}`);
      socket.emit('error', 'Partner not connected');
      return;
    }
    
    console.log(`📨 Forwarding answer to ${partnerSession.email} (${partnerSession.socketId})`);
    
    // Ensure the partner socket is still connected
    const partnerSocket = io.sockets.sockets.get(partnerSession.socketId);
    if (partnerSocket && partnerSocket.connected) {
      partnerSocket.emit('answer', data);
      console.log(`✅ Answer forwarded successfully to ${partnerSession.email}`);
    } else {
      console.log(`❌ Partner socket not connected for answer from ${socket.userEmail}`);
      socket.emit('error', 'Partner is not connected');
    }
  });

  socket.on('ice-candidate', (data) => {
    const session = activeSessions.get(socket.userId);
    if (session && session.partnerId) {
      const partnerSession = activeSessions.get(session.partnerId);
      if (partnerSession && partnerSession.socketId) {
        // Ensure the partner socket is still connected
        const partnerSocket = io.sockets.sockets.get(partnerSession.socketId);
        if (partnerSocket && partnerSocket.connected) {
          partnerSocket.emit('ice-candidate', data);
        }
      }
    }
  });

  // Handle call end
  socket.on('end-call', () => {
    const session = activeSessions.get(socket.userId);
    if (session && session.partnerId) {
      const partnerSession = activeSessions.get(session.partnerId);
      if (partnerSession) {
        io.to(partnerSession.socketId).emit('call-ended');
        
        // Reset both sessions
        session.status = 'connected';
        session.partnerId = null;
        session.roomId = null;
        session.isInActiveCall = false; // Reset active call flag
        activeSessions.set(socket.userId, session);
        
        partnerSession.status = 'connected';
        partnerSession.partnerId = null;
        partnerSession.roomId = null;
        partnerSession.isInActiveCall = false; // Reset active call flag
        activeSessions.set(session.partnerId, partnerSession);
      }
    }
  });

  // Handle video call start confirmation
  socket.on('video-call-started', () => {
    const session = activeSessions.get(socket.userId);
    if (session) {
      session.isInActiveCall = true;
      session.status = 'in-call';
      session.lastActivity = new Date();
      session.lastHeartbeat = new Date();
      activeSessions.set(socket.userId, session);
      
      console.log(`📹 Video call started for ${session.email}`);
      
      // Notify partner that video call has started
      if (session.partnerId) {
        const partnerSession = activeSessions.get(session.partnerId);
        if (partnerSession && partnerSession.socketId) {
          io.to(partnerSession.socketId).emit('partner-video-started');
        }
      }
    }
  });

  // Handle WebRTC connection state changes
  socket.on('webrtc-connection-state', (data) => {
    const session = activeSessions.get(socket.userId);
    if (session) {
      const { connectionState, iceConnectionState } = data;
      
      // Update connection quality based on connection state
      if (connectionState === 'connected' || iceConnectionState === 'connected') {
        session.connectionQuality = 'good';
        session.isInActiveCall = true;
        session.lastActivity = new Date();
        session.lastHeartbeat = new Date();
      } else if (connectionState === 'connecting' || iceConnectionState === 'checking') {
        session.connectionQuality = 'fair';
      } else if (connectionState === 'disconnected' || iceConnectionState === 'disconnected') {
        session.connectionQuality = 'poor';
        // Don't immediately set isInActiveCall to false - allow for reconnection
      } else if (connectionState === 'failed' || iceConnectionState === 'failed') {
        session.connectionQuality = 'poor';
        session.isInActiveCall = false;
      }
      
      activeSessions.set(socket.userId, session);
      
      console.log(`🔗 WebRTC state update for ${session.email}: ${connectionState}/${iceConnectionState}, quality: ${session.connectionQuality}, inCall: ${session.isInActiveCall}`);
    }
  });

  // Handle enhanced heartbeat with activity tracking and network status
  socket.on('heartbeat', (data = {}) => {
    const session = activeSessions.get(socket.userId);
    if (session) {
      const now = new Date();
      session.lastActivity = now;
      session.lastHeartbeat = now;
      
      // Update connection quality if provided
      if (data.connectionQuality) {
        session.connectionQuality = data.connectionQuality;
      }
      
      // Update active call status if provided
      if (data.hasOwnProperty('isInActiveCall')) {
        session.isInActiveCall = data.isInActiveCall;
      }
      
      // Handle network recovery status (Requirements 5.1, 5.3)
      if (data.networkRecovered) {
        console.log(`🌐 Network recovered for ${session.email}`);
        session.connectionQuality = 'good'; // Reset quality on network recovery
        
        // Notify partner about network recovery
        if (session.partnerId) {
          const partnerSession = activeSessions.get(session.partnerId);
          if (partnerSession && partnerSession.socketId) {
            io.to(partnerSession.socketId).emit('partner-network-recovered', {
              partnerId: socket.userId
            });
          }
        }
      }
      
      // Handle visibility status for better session management (Requirements 5.2)
      if (data.hasOwnProperty('isVisible')) {
        session.isVisible = data.isVisible;
        
        if (!data.isVisible && session.isInActiveCall) {
          console.log(`👁️ User ${session.email} tab became hidden during call`);
        } else if (data.isVisible && session.isInActiveCall) {
          console.log(`👁️ User ${session.email} tab became visible during call`);
        }
      }
      
      // Handle online status for network interruption tracking (Requirements 5.1)
      if (data.hasOwnProperty('isOnline')) {
        const wasOffline = session.isOnline === false;
        session.isOnline = data.isOnline;
        
        if (wasOffline && data.isOnline) {
          console.log(`🌐 User ${session.email} came back online`);
          
          // Notify partner about user coming back online
          if (session.partnerId) {
            const partnerSession = activeSessions.get(session.partnerId);
            if (partnerSession && partnerSession.socketId) {
              io.to(partnerSession.socketId).emit('partner-came-online', {
                partnerId: socket.userId
              });
            }
          }
        } else if (!data.isOnline) {
          console.log(`🌐 User ${session.email} went offline`);
          session.connectionQuality = 'poor';
        }
      }
      
      activeSessions.set(socket.userId, session);
      
      // Send enhanced heartbeat acknowledgment with session info
      socket.emit('heartbeat-ack', {
        timestamp: now,
        sessionActive: true,
        partnerId: session.partnerId,
        roomId: session.roomId,
        connectionQuality: session.connectionQuality
      });
    }
  });

  // Handle browser closing
  socket.on('browser-closing', () => {
    console.log(`🚪 ${socket.userEmail} browser closing`);
    handleDisconnection(socket);
  });

  // Enhanced session restore request with better state validation (Requirements 5.4, 5.5)
  socket.on('request-session-restore', () => {
    console.log(`🔄 Session restore requested by ${socket.userEmail}`);
    const session = activeSessions.get(socket.userId);
    
    if (session) {
      console.log(`📊 Current session for ${socket.userEmail}:`, {
        status: session.status,
        partnerId: session.partnerId,
        roomId: session.roomId,
        hasPartner: !!session.partnerId,
        isInActiveCall: session.isInActiveCall,
        lastActivity: session.lastActivity
      });
      
      if (session.partnerId && session.roomId) {
        const partnerSession = activeSessions.get(session.partnerId);
        console.log(`📊 Partner session exists: ${!!partnerSession}`);
        
        if (partnerSession) {
          // Validate that partner session is still valid and recent
          const partnerLastActivity = new Date(partnerSession.lastActivity);
          const timeSincePartnerActivity = Date.now() - partnerLastActivity.getTime();
          const maxInactivityTime = 15 * 60 * 1000; // 15 minutes
          
          if (timeSincePartnerActivity < maxInactivityTime) {
            // Notify partner about session restoration attempt
            if (partnerSession.socketId) {
              io.to(partnerSession.socketId).emit('partner-attempting-restore', {
                partnerId: socket.userId,
                partnerEmail: socket.userEmail
              });
            }
            
            socket.emit('session-restored', {
              partnerId: session.partnerId,
              roomId: session.roomId,
              wasReconnected: true,
              partnerLastSeen: partnerLastActivity,
              sessionAge: Date.now() - new Date(session.connectedAt).getTime()
            });
            
            // Update session status to indicate restoration
            session.status = 'matched';
            session.lastActivity = new Date();
            session.lastHeartbeat = new Date();
            activeSessions.set(socket.userId, session);
            
            console.log(`✅ Session restored for ${socket.userEmail}`);
          } else {
            console.log(`❌ Session restore failed for ${socket.userEmail}: partner inactive for ${Math.round(timeSincePartnerActivity/1000)}s`);
            
            // Clean up stale partner session
            activeSessions.delete(session.partnerId);
            
            // Reset current session
            session.partnerId = null;
            session.roomId = null;
            session.status = 'connected';
            session.isInActiveCall = false;
            activeSessions.set(socket.userId, session);
            
            socket.emit('session-restore-failed', {
              reason: 'Partner session expired due to inactivity'
            });
          }
        } else {
          console.log(`❌ Session restore failed for ${socket.userEmail}: partner session not found`);
          
          // Reset session since partner is gone
          session.partnerId = null;
          session.roomId = null;
          session.status = 'connected';
          session.isInActiveCall = false;
          activeSessions.set(socket.userId, session);
          
          socket.emit('session-restore-failed', {
            reason: 'Partner session no longer exists'
          });
        }
      } else {
        console.log(`❌ Session restore failed for ${socket.userEmail}: incomplete session data`);
        socket.emit('session-restore-failed', {
          reason: 'No active session found to restore'
        });
      }
    } else {
      console.log(`❌ Session restore failed for ${socket.userEmail}: no session found`);
      socket.emit('session-restore-failed', {
        reason: 'No user session found'
      });
    }
  });

  // Handle user reports
  socket.on('report-user', async (data) => {
    try {
      const { reportedUserId, category, description } = data;
      
      // Store report in database
      await db.collection('reports').insertOne({
        id: generateId(),
        reporterId: socket.userId,
        reportedUserId,
        category,
        description,
        timestamp: new Date(),
        status: 'pending',
        sessionId: activeSessions.get(socket.userId)?.roomId
      });

      console.log(`📝 Report filed: ${socket.userEmail} reported user ${reportedUserId}`);
      
      // End the current session
      socket.emit('call-ended');
      
    } catch (error) {
      console.error('Error handling report:', error);
      socket.emit('error', 'Failed to submit report');
    }
  });

  // Handle media state changes (audio/video/speaker)
  socket.on('media-state-change', (data) => {
    console.log(`🎬 Media state change from ${socket.userEmail}:`, data);
    const session = activeSessions.get(socket.userId);
    
    if (session && session.partnerId) {
      const partnerSession = activeSessions.get(session.partnerId);
      if (partnerSession && partnerSession.socketId) {
        const partnerSocket = io.sockets.sockets.get(partnerSession.socketId);
        if (partnerSocket && partnerSocket.connected) {
          partnerSocket.emit('media-state-change', data);
          console.log(`✅ Media state change forwarded to ${partnerSession.email}`);
        } else {
          console.log(`❌ Partner socket not connected for media state change`);
        }
      } else {
        console.log(`❌ Partner session not found for media state change`);
      }
    } else {
      console.log(`❌ No active session or partner for media state change`);
    }
  });

  // Handle skip user
  socket.on('skip-user', () => {
    const session = activeSessions.get(socket.userId);
    if (session && session.partnerId) {
      const partnerSession = activeSessions.get(session.partnerId);
      if (partnerSession) {
        // Notify partner
        io.to(partnerSession.socketId).emit('partner-disconnected');
        
        // Reset both sessions
        session.status = 'connected';
        session.partnerId = null;
        session.roomId = null;
        session.isInActiveCall = false; // Reset active call flag
        activeSessions.set(socket.userId, session);
        
        partnerSession.status = 'connected';
        partnerSession.partnerId = null;
        partnerSession.roomId = null;
        partnerSession.isInActiveCall = false; // Reset active call flag
        activeSessions.set(session.partnerId, partnerSession);
      }
    }
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log(`❌ User disconnected: ${socket.userEmail} (${reason})`);
    handleDisconnection(socket);
  });
});

// Helper functions
function findMatch(userId) {
  const currentUser = activeSessions.get(userId);
  if (!currentUser) return;

  // Find another user in matching pool (excluding current user)
  for (const potentialMatchId of matchingPool) {
    if (potentialMatchId !== userId) {
      const potentialMatch = activeSessions.get(potentialMatchId);
      
      // Check if they're from the same university
      if (potentialMatch && potentialMatch.university === currentUser.university) {
        createMatch(userId, potentialMatchId);
        return;
      }
    }
  }
}

function createMatch(userId1, userId2) {
  const user1Session = activeSessions.get(userId1);
  const user2Session = activeSessions.get(userId2);

  if (!user1Session || !user2Session) {
    console.log(`❌ Cannot create match: missing sessions. User1: ${!!user1Session}, User2: ${!!user2Session}`);
    return;
  }

  const roomId = generateRoomId();

  console.log(`🎯 Creating match between ${user1Session.email} and ${user2Session.email}`);
  console.log(`📊 Before match - User1 session:`, {
    userId: userId1,
    socketId: user1Session.socketId,
    status: user1Session.status
  });
  console.log(`📊 Before match - User2 session:`, {
    userId: userId2,
    socketId: user2Session.socketId,
    status: user2Session.status
  });

  // Remove from matching pool
  matchingPool.delete(userId1);
  matchingPool.delete(userId2);

  // Update sessions
  user1Session.status = 'matched';
  user1Session.partnerId = userId2;
  user1Session.roomId = roomId;
  user1Session.lastActivity = new Date(); // Update activity timestamp
  user1Session.isInActiveCall = false; // Will be set to true when video call actually starts
  activeSessions.set(userId1, user1Session);

  user2Session.status = 'matched';
  user2Session.partnerId = userId1;
  user2Session.roomId = roomId;
  user2Session.lastActivity = new Date(); // Update activity timestamp
  user2Session.isInActiveCall = false; // Will be set to true when video call actually starts
  activeSessions.set(userId2, user2Session);

  console.log(`📊 After match - User1 session:`, {
    userId: userId1,
    partnerId: user1Session.partnerId,
    roomId: user1Session.roomId,
    status: user1Session.status
  });
  console.log(`📊 After match - User2 session:`, {
    userId: userId2,
    partnerId: user2Session.partnerId,
    roomId: user2Session.roomId,
    status: user2Session.status
  });

  // Notify both users
  const user1Socket = io.sockets.sockets.get(user1Session.socketId);
  const user2Socket = io.sockets.sockets.get(user2Session.socketId);
  
  if (user1Socket && user1Socket.connected) {
    user1Socket.emit('match-found', {
      partnerId: userId2,
      roomId: roomId
    });
    console.log(`✅ Match notification sent to ${user1Session.email}`);
  } else {
    console.log(`❌ Cannot notify ${user1Session.email}: socket not connected`);
  }
  
  if (user2Socket && user2Socket.connected) {
    user2Socket.emit('match-found', {
      partnerId: userId1,
      roomId: roomId
    });
    console.log(`✅ Match notification sent to ${user2Session.email}`);
  } else {
    console.log(`❌ Cannot notify ${user2Session.email}: socket not connected`);
  }

  console.log(`💕 Match created: ${user1Session.email} ↔ ${user2Session.email} (Room: ${roomId})`);
  console.log(`📊 Total active sessions: ${activeSessions.size}`);
}

function handleDisconnection(socket) {
  const session = activeSessions.get(socket.userId);
  if (!session) return;

  // Remove from matching pool
  matchingPool.delete(socket.userId);

  // If user was in a call, notify partner
  if (session.partnerId) {
    const partnerSession = activeSessions.get(session.partnerId);
    if (partnerSession) {
      io.to(partnerSession.socketId).emit('partner-disconnected');
      
      // Reset partner session
      partnerSession.status = 'connected';
      partnerSession.partnerId = null;
      partnerSession.roomId = null;
      partnerSession.isInActiveCall = false; // Reset active call flag
      activeSessions.set(session.partnerId, partnerSession);
    }
  }

  // Remove session
  activeSessions.delete(socket.userId);
}

function generateRoomId() {
  return 'room_' + Math.random().toString(36).substr(2, 9);
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// Enhanced cleanup for inactive sessions with active call consideration
setInterval(() => {
  const now = new Date();
  // Updated: Use centralized configuration for timeout values (Requirements 4.4)
  const HEARTBEAT_TIMEOUT_MS = CONNECTION_CONFIG.sessionInactivityTimeout; // 10 minutes for heartbeat timeout
  const INACTIVE_CALL_TIMEOUT_MS = CONNECTION_CONFIG.activeCallInactivityTimeout; // 30 minutes for inactive calls

  for (const [userId, session] of activeSessions.entries()) {
    let shouldTimeout = false;
    let timeoutReason = '';
    
    // Check if session has required fields (for backward compatibility)
    if (!session.lastHeartbeat) {
      session.lastHeartbeat = session.lastActivity || session.connectedAt;
    }
    if (!session.hasOwnProperty('isInActiveCall')) {
      session.isInActiveCall = false;
    }
    
    // Calculate time since last heartbeat
    const timeSinceHeartbeat = now - (session.lastHeartbeat || session.connectedAt);
    
    if (session.isInActiveCall) {
      // For users in active calls, use longer timeout and only check heartbeat
      if (timeSinceHeartbeat > INACTIVE_CALL_TIMEOUT_MS) {
        shouldTimeout = true;
        timeoutReason = 'No heartbeat during active call';
      }
    } else {
      // For users not in active calls, use standard heartbeat timeout
      if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS) {
        shouldTimeout = true;
        timeoutReason = 'Heartbeat timeout';
      }
    }
    
    if (shouldTimeout) {
      console.log(`⏰ Session timeout: ${session.email} (${timeoutReason})`);
      console.log(`📊 Session details: isInActiveCall=${session.isInActiveCall}, timeSinceHeartbeat=${Math.round(timeSinceHeartbeat/1000)}s`);
      
      // Remove from matching pool
      matchingPool.delete(userId);
      
      // Notify partner if in call
      if (session.partnerId) {
        const partnerSession = activeSessions.get(session.partnerId);
        if (partnerSession) {
          io.to(partnerSession.socketId).emit('partner-timeout');
          
          // Reset partner session
          partnerSession.status = 'connected';
          partnerSession.partnerId = null;
          partnerSession.roomId = null;
          partnerSession.isInActiveCall = false;
          activeSessions.set(session.partnerId, partnerSession);
        }
      }
      
      // Remove session
      activeSessions.delete(userId);
    }
  }
}, CONNECTION_CONFIG.sessionCleanupInterval); // Updated: Run every 2 minutes for more responsive cleanup

// Start server
async function startServer() {
  await connectToDatabase();
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Socket.io server running on port ${PORT}`);
    console.log(`🌐 CORS enabled for: ${CORS_ORIGINS.join(', ')}`);
  });

  server.on('error', (error) => {
    console.error('❌ Server error:', error);
  });
}

startServer().catch(console.error);