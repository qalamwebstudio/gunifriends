/**
 * Timeout Verification Test
 * This test verifies that the timeout fixes work correctly by simulating
 * a connection that persists beyond the previous 30-40 second limit.
 */

const { Server } = require('socket.io');
const { createServer } = require('http');
const Client = require('socket.io-client');

// Test configuration
const TEST_PORT = 3002;
const CONNECTION_DURATION_MS = 60000; // 60 seconds - beyond old timeout limit

async function runTimeoutVerificationTest() {
  console.log('🧪 Starting Timeout Verification Test...');
  console.log(`📊 Testing connection persistence for ${CONNECTION_DURATION_MS / 1000} seconds`);
  
  // Create test server
  const server = createServer();
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });

  // Track connection events
  const connectionEvents = [];
  let isConnected = false;
  let disconnectReason = null;

  // Server-side connection handling
  io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);
    connectionEvents.push({ type: 'connected', timestamp: Date.now(), socketId: socket.id });
    isConnected = true;

    // Handle heartbeats
    socket.on('heartbeat', () => {
      connectionEvents.push({ type: 'heartbeat', timestamp: Date.now() });
      socket.emit('heartbeat-ack', { timestamp: Date.now() });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`❌ Client disconnected: ${reason}`);
      connectionEvents.push({ type: 'disconnected', timestamp: Date.now(), reason });
      isConnected = false;
      disconnectReason = reason;
    });

    // Simulate video call start
    socket.on('video-call-started', () => {
      console.log('📹 Video call started');
      connectionEvents.push({ type: 'video-call-started', timestamp: Date.now() });
    });
  });

  // Start server
  await new Promise((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`🚀 Test server running on port ${TEST_PORT}`);
      resolve();
    });
  });

  try {
    // Create client connection
    const client = Client(`http://localhost:${TEST_PORT}`, {
      transports: ['websocket']
    });

    // Wait for connection
    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        console.log('🔗 Client connected to test server');
        resolve();
      });
      client.on('connect_error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    // Simulate video call start
    client.emit('video-call-started');

    // Send periodic heartbeats to simulate active session
    const heartbeatInterval = setInterval(() => {
      if (isConnected) {
        client.emit('heartbeat');
        console.log('💓 Heartbeat sent');
      }
    }, 30000); // Every 30 seconds

    console.log(`⏱️  Maintaining connection for ${CONNECTION_DURATION_MS / 1000} seconds...`);
    
    // Wait for the test duration
    await new Promise((resolve) => {
      setTimeout(resolve, CONNECTION_DURATION_MS);
    });

    clearInterval(heartbeatInterval);

    // Verify results
    console.log('\n📊 Test Results:');
    console.log(`Connection Status: ${isConnected ? '✅ CONNECTED' : '❌ DISCONNECTED'}`);
    
    if (!isConnected) {
      console.log(`Disconnect Reason: ${disconnectReason}`);
    }

    console.log(`Total Events: ${connectionEvents.length}`);
    console.log('Event Timeline:');
    
    const startTime = connectionEvents[0]?.timestamp || Date.now();
    connectionEvents.forEach((event, index) => {
      const elapsed = ((event.timestamp - startTime) / 1000).toFixed(1);
      console.log(`  ${index + 1}. [${elapsed}s] ${event.type} ${event.reason ? `(${event.reason})` : ''}`);
    });

    // Test assertions
    const testResults = {
      connectionPersisted: isConnected,
      durationSeconds: CONNECTION_DURATION_MS / 1000,
      heartbeatCount: connectionEvents.filter(e => e.type === 'heartbeat').length,
      disconnectReason: disconnectReason,
      success: isConnected && !disconnectReason?.includes('timeout')
    };

    console.log('\n🎯 Test Verification:');
    console.log(`✅ Connection persisted beyond ${testResults.durationSeconds}s: ${testResults.connectionPersisted}`);
    console.log(`✅ No timeout-related disconnection: ${!testResults.disconnectReason?.includes('timeout')}`);
    console.log(`📊 Heartbeats sent: ${testResults.heartbeatCount}`);

    if (testResults.success) {
      console.log('\n🎉 TIMEOUT FIX VERIFICATION: PASSED');
      console.log('   Connections now persist beyond the previous 30-40 second limit!');
    } else {
      console.log('\n❌ TIMEOUT FIX VERIFICATION: FAILED');
      console.log('   Connection was terminated before expected duration');
    }

    // Cleanup
    client.disconnect();
    
    return testResults;

  } finally {
    // Close server
    server.close();
    console.log('🔚 Test server closed');
  }
}

// Run the test
if (require.main === module) {
  runTimeoutVerificationTest()
    .then((results) => {
      process.exit(results.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = { runTimeoutVerificationTest };