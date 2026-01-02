# Socket.io Server for University Video Chat

This is a standalone Socket.io server that can be deployed to Render or any other cloud service that supports WebSocket connections.

## Features

- Real-time user matching
- WebRTC signaling for video calls
- User authentication via JWT
- MongoDB integration for data persistence
- CORS support for multiple origins
- Session management and cleanup
- User reporting system

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env` and update the values:
   ```bash
   cp .env.example .env
   ```

3. **Run locally:**
   ```bash
   npm run dev
   ```

4. **Run in production:**
   ```bash
   npm start
   ```

## Environment Variables

- `PORT`: Server port (default: 3001)
- `JWT_SECRET`: JWT secret key (must match your main app)
- `MONGODB_URI`: MongoDB connection string
- `DATABASE_NAME`: MongoDB database name
- `CORS_ORIGINS`: Comma-separated list of allowed origins

## Deployment to Render

1. **Create a new Web Service on Render**
2. **Connect your GitHub repository**
3. **Set the following:**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: Node
4. **Add environment variables** in Render dashboard
5. **Deploy**

## Integration with Main App

After deploying to Render, you'll get a URL like: `https://your-app-name.onrender.com`

Add this to your main app's environment variables:
```
NEXT_PUBLIC_SOCKET_URL=https://your-app-name.onrender.com
```

## API Endpoints

The server listens for Socket.io connections on the root path (`/`).

### Socket Events

**Client to Server:**
- `join-matching-pool`: Join the matching queue
- `leave-matching-pool`: Leave the matching queue
- `offer`: WebRTC offer
- `answer`: WebRTC answer
- `ice-candidate`: ICE candidate
- `end-call`: End current call
- `heartbeat`: Keep session alive
- `browser-closing`: Notify server of browser close
- `request-session-restore`: Request session restoration
- `report-user`: Report a user
- `skip-user`: Skip current partner

**Server to Client:**
- `match-found`: Match found with partner
- `offer`: WebRTC offer from partner
- `answer`: WebRTC answer from partner
- `ice-candidate`: ICE candidate from partner
- `call-ended`: Call ended by partner
- `partner-disconnected`: Partner disconnected
- `partner-timeout`: Partner session timed out
- `session-restored`: Session restored successfully
- `session-restore-failed`: Session restoration failed
- `error`: Error message

## Health Check

The server automatically logs connection status and active sessions.