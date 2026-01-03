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
    credentials: true
  },
  transports: ['websocket', 'polling']
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

  // Store active session
  activeSessions.set(socket.userId, {
    socketId: socket.id,
    userId: socket.userId,
    email: socket.userEmail,
    university: socket.university,
    status: 'connected',
    connectedAt: new Date()
  });

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

  // Handle WebRTC signaling
  socket.on('offer', (data) => {
    console.log(`📤 Offer received from ${socket.userEmail}`);
    const session = activeSessions.get(socket.userId);
    if (session && session.partnerId) {
      const partnerSession = activeSessions.get(session.partnerId);
      if (partnerSession) {
        console.log(`📨 Forwarding offer to ${partnerSession.email}`);
        io.to(partnerSession.socketId).emit('offer', data);
      } else {
        console.log(`❌ Partner session not found for offer from ${socket.userEmail}`);
      }
    } else {
      console.log(`❌ No partner found for offer from ${socket.userEmail}`);
    }
  });

  socket.on('answer', (data) => {
    console.log(`📤 Answer received from ${socket.userEmail}`);
    const session = activeSessions.get(socket.userId);
    if (session && session.partnerId) {
      const partnerSession = activeSessions.get(session.partnerId);
      if (partnerSession) {
        console.log(`📨 Forwarding answer to ${partnerSession.email}`);
        io.to(partnerSession.socketId).emit('answer', data);
      } else {
        console.log(`❌ Partner session not found for answer from ${socket.userEmail}`);
      }
    } else {
      console.log(`❌ No partner found for answer from ${socket.userEmail}`);
    }
  });

  socket.on('ice-candidate', (data) => {
    const session = activeSessions.get(socket.userId);
    if (session && session.partnerId) {
      const partnerSession = activeSessions.get(session.partnerId);
      if (partnerSession) {
        io.to(partnerSession.socketId).emit('ice-candidate', data);
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
    const session = activeSessions.get(socket.userId);
    if (session && session.partnerId && session.roomId) {
      socket.emit('session-restored', {
        partnerId: session.partnerId,
        roomId: session.roomId,
        wasReconnected: true
      });
    } else {
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

  if (!user1Session || !user2Session) return;

  const roomId = generateRoomId();

  // Remove from matching pool
  matchingPool.delete(userId1);
  matchingPool.delete(userId2);

  // Update sessions
  user1Session.status = 'matched';
  user1Session.partnerId = userId2;
  user1Session.roomId = roomId;
  activeSessions.set(userId1, user1Session);

  user2Session.status = 'matched';
  user2Session.partnerId = userId1;
  user2Session.roomId = roomId;
  activeSessions.set(userId2, user2Session);

  // Notify both users
  io.to(user1Session.socketId).emit('match-found', {
    partnerId: userId2,
    roomId: roomId
  });

  io.to(user2Session.socketId).emit('match-found', {
    partnerId: userId1,
    roomId: roomId
  });

  console.log(`💕 Match created: ${user1Session.email} ↔ ${user2Session.email} (Room: ${roomId})`);
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
  
  server.listen(PORT, () => {
    console.log(`🚀 Socket.io server running on port ${PORT}`);
    console.log(`🌐 CORS enabled for: ${CORS_ORIGINS.join(', ')}`);
  });
}

startServer().catch(console.error);