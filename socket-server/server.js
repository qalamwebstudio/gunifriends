const { Server } = require('socket.io');
const { createServer } = require('http');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
require('dotenv').config();

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

// Create Socket.io server with CORS
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
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
    // Update existing session with new socket ID
    console.log(`🔄 Updating socket ID for ${socket.userEmail}: ${existingSession.socketId} → ${socket.id}`);
    existingSession.socketId = socket.id;
    existingSession.connectedAt = new Date();
    activeSessions.set(socket.userId, existingSession);
  } else {
    // Create new session
    activeSessions.set(socket.userId, {
      socketId: socket.id,
      userId: socket.userId,
      email: socket.userEmail,
      university: socket.university,
      status: 'connected',
      connectedAt: new Date()
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
        activeSessions.set(socket.userId, session);
        
        partnerSession.status = 'connected';
        partnerSession.partnerId = null;
        partnerSession.roomId = null;
        activeSessions.set(session.partnerId, partnerSession);
      }
    }
  });

  // Handle heartbeat
  socket.on('heartbeat', () => {
    const session = activeSessions.get(socket.userId);
    if (session) {
      session.lastActivity = new Date();
      activeSessions.set(socket.userId, session);
    }
  });

  // Handle browser closing
  socket.on('browser-closing', () => {
    console.log(`🚪 ${socket.userEmail} browser closing`);
    handleDisconnection(socket);
  });

  // Handle session restore request
  socket.on('request-session-restore', () => {
    console.log(`🔄 Session restore requested by ${socket.userEmail}`);
    const session = activeSessions.get(socket.userId);
    
    if (session) {
      console.log(`📊 Current session for ${socket.userEmail}:`, {
        status: session.status,
        partnerId: session.partnerId,
        roomId: session.roomId,
        hasPartner: !!session.partnerId
      });
      
      if (session.partnerId && session.roomId) {
        const partnerSession = activeSessions.get(session.partnerId);
        console.log(`📊 Partner session exists: ${!!partnerSession}`);
        
        socket.emit('session-restored', {
          partnerId: session.partnerId,
          roomId: session.roomId,
          wasReconnected: true
        });
        console.log(`✅ Session restored for ${socket.userEmail}`);
      } else {
        console.log(`❌ Session restore failed for ${socket.userEmail}: incomplete session data`);
        socket.emit('session-restore-failed', {
          reason: 'No active session found'
        });
      }
    } else {
      console.log(`❌ Session restore failed for ${socket.userEmail}: no session found`);
      socket.emit('session-restore-failed', {
        reason: 'No active session found'
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
        activeSessions.set(socket.userId, session);
        
        partnerSession.status = 'connected';
        partnerSession.partnerId = null;
        partnerSession.roomId = null;
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
  activeSessions.set(userId1, user1Session);

  user2Session.status = 'matched';
  user2Session.partnerId = userId1;
  user2Session.roomId = roomId;
  user2Session.lastActivity = new Date(); // Update activity timestamp
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

// Cleanup inactive sessions (run every 5 minutes)
setInterval(() => {
  const now = new Date();
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  for (const [userId, session] of activeSessions.entries()) {
    if (session.lastActivity && (now - session.lastActivity) > TIMEOUT_MS) {
      console.log(`⏰ Session timeout: ${session.email}`);
      
      // Remove from matching pool
      matchingPool.delete(userId);
      
      // Notify partner if in call
      if (session.partnerId) {
        const partnerSession = activeSessions.get(session.partnerId);
        if (partnerSession) {
          io.to(partnerSession.socketId).emit('partner-timeout');
        }
      }
      
      // Remove session
      activeSessions.delete(userId);
    }
  }
}, 5 * 60 * 1000);

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