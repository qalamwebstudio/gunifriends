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

  // Note: Socket.IO server is running separately on port 3001
  // See socket-server/server.js for the Socket.IO implementation

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log('> Socket.io server running separately on port 3001');
  });
});