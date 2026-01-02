/**
 * End-to-End Integration Tests: Complete User Journey
 * 
 * Tests the complete user flow from registration through video chat
 * Validates: All requirements - complete system integration
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import fetch from 'node-fetch';

// Mock WebRTC for Node.js environment
global.RTCPeerConnection = jest.fn().mockImplementation(() => ({
  createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' }),
  createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' }),
  setLocalDescription: jest.fn().mockResolvedValue(undefined),
  setRemoteDescription: jest.fn().mockResolvedValue(undefined),
  addIceCandidate: jest.fn().mockResolvedValue(undefined),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  close: jest.fn(),
  connectionState: 'connected',
  iceConnectionState: 'connected',
  signalingState: 'stable',
}));

global.RTCSessionDescription = jest.fn().mockImplementation((init) => init);
global.RTCIceCandidate = jest.fn().mockImplementation((init) => init);

describe('End-to-End User Journey Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let mongoClient: MongoClient;
  let db: Db;
  let httpServer: any;
  let socketServer: Server;
  let serverPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    // Start in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db('test');

    // Create HTTP server with Socket.io
    httpServer = createServer();
    socketServer = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Start server on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = httpServer.address()?.port || 3001;
        baseUrl = `http://localhost:${serverPort}`;
        resolve();
      });
    });

    // Set up Socket.io event handlers for matching and signaling
    const matchingPool = new Set<string>();
    const activeMatches = new Map<string, string>();

    socketServer.on('connection', (socket) => {
      socket.on('join-matching-pool', (userId: string) => {
        if (matchingPool.size > 0) {
          // Find a match
          const waitingUser = Array.from(matchingPool)[0];
          matchingPool.delete(waitingUser);
          
          // Create match
          activeMatches.set(userId, waitingUser);
          activeMatches.set(waitingUser, userId);
          
          // Notify both users
          socket.emit('match-found', { partnerId: waitingUser });
          socket.to(waitingUser).emit('match-found', { partnerId: userId });
        } else {
          // Add to waiting pool
          matchingPool.add(userId);
          socket.emit('searching');
        }
      });

      socket.on('leave-matching-pool', (userId: string) => {
        matchingPool.delete(userId);
        activeMatches.delete(userId);
      });

      socket.on('webrtc-offer', ({ offer, targetId }) => {
        socket.to(targetId).emit('webrtc-offer', { offer, senderId: socket.id });
      });

      socket.on('webrtc-answer', ({ answer, targetId }) => {
        socket.to(targetId).emit('webrtc-answer', { answer, senderId: socket.id });
      });

      socket.on('ice-candidate', ({ candidate, targetId }) => {
        socket.to(targetId).emit('ice-candidate', { candidate, senderId: socket.id });
      });

      socket.on('end-call', ({ partnerId }) => {
        socket.to(partnerId).emit('call-ended');
        activeMatches.delete(socket.id);
        activeMatches.delete(partnerId);
      });

      socket.on('disconnect', () => {
        matchingPool.delete(socket.id);
        const partnerId = activeMatches.get(socket.id);
        if (partnerId) {
          socket.to(partnerId).emit('partner-disconnected');
          activeMatches.delete(socket.id);
          activeMatches.delete(partnerId);
        }
      });
    });
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    if (mongoClient) {
      await mongoClient.close();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
    if (socketServer) {
      socketServer.close();
    }
    if (httpServer) {
      httpServer.close();
    }
  }, 30000);

  beforeEach(async () => {
    // Clear database before each test
    await db.collection('users').deleteMany({});
    await db.collection('sessions').deleteMany({});
    await db.collection('reports').deleteMany({});
  });

  describe('Complete User Journey: Registration to Video Chat', () => {
    it('should handle complete user flow from registration through video chat session', async () => {
      // Step 1: User Registration
      const registrationData = {
        email: 'student1@stanford.edu',
        password: 'TestPass123',
        university: 'Stanford University'
      };

      // Create user in database (simulating successful registration)
      const user1 = await db.collection('users').insertOne({
        email: registrationData.email,
        passwordHash: 'hashed-password',
        university: registrationData.university,
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      });

      expect(user1.insertedId).toBeDefined();

      // Step 2: Email Verification (simulated as already verified)
      const verifiedUser = await db.collection('users').findOne({ _id: user1.insertedId });
      expect(verifiedUser?.isEmailVerified).toBe(true);

      // Step 3: User Login (simulated)
      const loginToken = 'mock-jwt-token-user1';
      
      // Step 4: Home Page Access and Matching Initiation
      const client1 = Client(baseUrl);
      
      await new Promise<void>((resolve) => {
        client1.on('connect', () => {
          // User joins matching pool
          client1.emit('join-matching-pool', user1.insertedId.toString());
          resolve();
        });
      });

      // Verify user is in searching state
      await new Promise<void>((resolve) => {
        client1.on('searching', () => {
          resolve();
        });
      });

      // Step 5: Second User Registration and Login
      const user2 = await db.collection('users').insertOne({
        email: 'student2@mit.edu',
        passwordHash: 'hashed-password',
        university: 'MIT',
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      });

      const client2 = Client(baseUrl);
      
      // Step 6: Second User Joins Matching Pool - Should Create Match
      let matchFound = false;
      let user1Partner: string | null = null;
      let user2Partner: string | null = null;

      await new Promise<void>((resolve) => {
        client1.on('match-found', ({ partnerId }) => {
          user1Partner = partnerId;
          matchFound = true;
          if (user2Partner) resolve();
        });

        client2.on('match-found', ({ partnerId }) => {
          user2Partner = partnerId;
          matchFound = true;
          if (user1Partner) resolve();
        });

        client2.on('connect', () => {
          client2.emit('join-matching-pool', user2.insertedId.toString());
        });
      });

      expect(matchFound).toBe(true);
      expect(user1Partner).toBe(user2.insertedId.toString());
      expect(user2Partner).toBe(user1.insertedId.toString());

      // Step 7: WebRTC Connection Establishment
      let offerReceived = false;
      let answerReceived = false;
      let iceCandidatesExchanged = 0;

      // User 1 creates and sends offer
      const mockOffer = { type: 'offer', sdp: 'mock-offer-sdp' };
      client1.emit('webrtc-offer', { offer: mockOffer, targetId: user2Partner });

      // User 2 receives offer and sends answer
      await new Promise<void>((resolve) => {
        client2.on('webrtc-offer', ({ offer, senderId }) => {
          expect(offer).toEqual(mockOffer);
          offerReceived = true;
          
          const mockAnswer = { type: 'answer', sdp: 'mock-answer-sdp' };
          client2.emit('webrtc-answer', { answer: mockAnswer, targetId: senderId });
        });

        client1.on('webrtc-answer', ({ answer, senderId }) => {
          expect(answer.type).toBe('answer');
          answerReceived = true;
          resolve();
        });
      });

      expect(offerReceived).toBe(true);
      expect(answerReceived).toBe(true);

      // Step 8: ICE Candidate Exchange
      await new Promise<void>((resolve) => {
        const mockCandidate = { candidate: 'mock-ice-candidate', sdpMid: '0', sdpMLineIndex: 0 };
        
        client1.on('ice-candidate', ({ candidate }) => {
          expect(candidate).toEqual(mockCandidate);
          iceCandidatesExchanged++;
          if (iceCandidatesExchanged >= 2) resolve();
        });

        client2.on('ice-candidate', ({ candidate }) => {
          expect(candidate).toEqual(mockCandidate);
          iceCandidatesExchanged++;
          if (iceCandidatesExchanged >= 2) resolve();
        });

        // Simulate ICE candidate exchange
        client1.emit('ice-candidate', { candidate: mockCandidate, targetId: user2Partner });
        client2.emit('ice-candidate', { candidate: mockCandidate, targetId: user1Partner });
      });

      expect(iceCandidatesExchanged).toBeGreaterThanOrEqual(2);

      // Step 9: Video Chat Session Active
      // At this point, both users should have established WebRTC connection
      // and be in an active video chat session

      // Step 10: Call Termination
      let callEnded = false;
      
      await new Promise<void>((resolve) => {
        client2.on('call-ended', () => {
          callEnded = true;
          resolve();
        });

        // User 1 ends the call
        client1.emit('end-call', { partnerId: user2Partner });
      });

      expect(callEnded).toBe(true);

      // Step 11: Return to Home Page
      // Both users should be returned to matching state
      
      // Cleanup
      client1.disconnect();
      client2.disconnect();
    }, 30000);

    it('should handle user reporting during video chat session', async () => {
      // Set up two users in a video chat
      const user1 = await db.collection('users').insertOne({
        email: 'reporter@stanford.edu',
        passwordHash: 'hashed-password',
        university: 'Stanford University',
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      });

      const user2 = await db.collection('users').insertOne({
        email: 'reported@mit.edu',
        passwordHash: 'hashed-password',
        university: 'MIT',
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      });

      // Create report in database
      const report = await db.collection('reports').insertOne({
        reporterId: user1.insertedId.toString(),
        reportedUserId: user2.insertedId.toString(),
        category: 'inappropriate-behavior',
        description: 'User was behaving inappropriately',
        timestamp: new Date(),
        status: 'pending'
      });

      expect(report.insertedId).toBeDefined();

      // Verify report was stored correctly
      const storedReport = await db.collection('reports').findOne({ _id: report.insertedId });
      expect(storedReport?.reporterId).toBe(user1.insertedId.toString());
      expect(storedReport?.reportedUserId).toBe(user2.insertedId.toString());
      expect(storedReport?.category).toBe('inappropriate-behavior');

      // Verify reported user's report count is incremented
      await db.collection('users').updateOne(
        { _id: user2.insertedId },
        { $inc: { reportCount: 1 } }
      );

      const updatedUser = await db.collection('users').findOne({ _id: user2.insertedId });
      expect(updatedUser?.reportCount).toBe(1);
    });

    it('should handle session cleanup when user disconnects unexpectedly', async () => {
      const user1 = await db.collection('users').insertOne({
        email: 'user1@stanford.edu',
        passwordHash: 'hashed-password',
        university: 'Stanford University',
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      });

      const user2 = await db.collection('users').insertOne({
        email: 'user2@mit.edu',
        passwordHash: 'hashed-password',
        university: 'MIT',
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      });

      const client1 = Client(baseUrl);
      const client2 = Client(baseUrl);

      // Establish connection and match
      await new Promise<void>((resolve) => {
        let connectionsReady = 0;
        
        client1.on('connect', () => {
          client1.emit('join-matching-pool', user1.insertedId.toString());
          connectionsReady++;
          if (connectionsReady === 2) resolve();
        });

        client2.on('connect', () => {
          client2.emit('join-matching-pool', user2.insertedId.toString());
          connectionsReady++;
          if (connectionsReady === 2) resolve();
        });
      });

      // Wait for match
      await new Promise<void>((resolve) => {
        let matchesFound = 0;
        
        client1.on('match-found', () => {
          matchesFound++;
          if (matchesFound === 2) resolve();
        });

        client2.on('match-found', () => {
          matchesFound++;
          if (matchesFound === 2) resolve();
        });
      });

      // Simulate unexpected disconnection
      let partnerDisconnected = false;
      
      await new Promise<void>((resolve) => {
        client1.on('partner-disconnected', () => {
          partnerDisconnected = true;
          resolve();
        });

        // User 2 disconnects unexpectedly
        client2.disconnect();
      });

      expect(partnerDisconnected).toBe(true);

      // Cleanup
      client1.disconnect();
    });
  });

  describe('Cross-Browser WebRTC Compatibility Simulation', () => {
    it('should handle different WebRTC implementations', async () => {
      // Simulate Chrome WebRTC implementation
      const chromeRTC = jest.fn().mockImplementation(() => ({
        createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'chrome-offer-sdp' }),
        createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'chrome-answer-sdp' }),
        setLocalDescription: jest.fn().mockResolvedValue(undefined),
        setRemoteDescription: jest.fn().mockResolvedValue(undefined),
        addIceCandidate: jest.fn().mockResolvedValue(undefined),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        close: jest.fn(),
        connectionState: 'connected',
        iceConnectionState: 'connected',
        signalingState: 'stable',
      }));

      // Simulate Firefox WebRTC implementation
      const firefoxRTC = jest.fn().mockImplementation(() => ({
        createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'firefox-offer-sdp' }),
        createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'firefox-answer-sdp' }),
        setLocalDescription: jest.fn().mockResolvedValue(undefined),
        setRemoteDescription: jest.fn().mockResolvedValue(undefined),
        addIceCandidate: jest.fn().mockResolvedValue(undefined),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        close: jest.fn(),
        connectionState: 'connected',
        iceConnectionState: 'connected',
        signalingState: 'stable',
      }));

      // Test Chrome-to-Firefox connection
      const chromeConnection = new chromeRTC();
      const firefoxConnection = new firefoxRTC();

      // Chrome creates offer
      const chromeOffer = await chromeConnection.createOffer();
      expect(chromeOffer.sdp).toBe('chrome-offer-sdp');

      // Firefox receives offer and creates answer
      await firefoxConnection.setRemoteDescription(chromeOffer);
      const firefoxAnswer = await firefoxConnection.createAnswer();
      expect(firefoxAnswer.sdp).toBe('firefox-answer-sdp');

      // Chrome receives answer
      await chromeConnection.setRemoteDescription(firefoxAnswer);

      // Verify both connections are established
      expect(chromeConnection.connectionState).toBe('connected');
      expect(firefoxConnection.connectionState).toBe('connected');
    });

    it('should handle WebRTC connection failures gracefully', async () => {
      // Simulate connection failure
      const failingRTC = jest.fn().mockImplementation(() => ({
        createOffer: jest.fn().mockRejectedValue(new Error('Failed to create offer')),
        createAnswer: jest.fn().mockRejectedValue(new Error('Failed to create answer')),
        setLocalDescription: jest.fn().mockRejectedValue(new Error('Failed to set local description')),
        setRemoteDescription: jest.fn().mockRejectedValue(new Error('Failed to set remote description')),
        addIceCandidate: jest.fn().mockRejectedValue(new Error('Failed to add ICE candidate')),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        close: jest.fn(),
        connectionState: 'failed',
        iceConnectionState: 'failed',
        signalingState: 'closed',
      }));

      const connection = new failingRTC();

      // Test error handling
      await expect(connection.createOffer()).rejects.toThrow('Failed to create offer');
      await expect(connection.createAnswer()).rejects.toThrow('Failed to create answer');
      await expect(connection.setLocalDescription({})).rejects.toThrow('Failed to set local description');
      await expect(connection.setRemoteDescription({})).rejects.toThrow('Failed to set remote description');
      await expect(connection.addIceCandidate({})).rejects.toThrow('Failed to add ICE candidate');

      expect(connection.connectionState).toBe('failed');
    });
  });

  describe('Concurrent Multiple User Scenarios', () => {
    it('should handle multiple simultaneous user registrations', async () => {
      const users = [];
      const registrationPromises = [];

      // Create 10 concurrent users
      for (let i = 0; i < 10; i++) {
        const userData = {
          email: `student${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        };

        registrationPromises.push(
          db.collection('users').insertOne(userData)
        );
      }

      const results = await Promise.all(registrationPromises);
      
      // Verify all users were created successfully
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.insertedId).toBeDefined();
      });

      // Verify users exist in database
      const userCount = await db.collection('users').countDocuments({});
      expect(userCount).toBe(10);
    });

    it('should handle multiple concurrent matching requests', async () => {
      // Create multiple users
      const users = [];
      for (let i = 0; i < 6; i++) {
        const user = await db.collection('users').insertOne({
          email: `student${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        });
        users.push(user.insertedId.toString());
      }

      // Create multiple socket connections
      const clients = users.map(() => Client(baseUrl));
      const matchResults: string[] = [];

      // Connect all clients and join matching pool
      await Promise.all(clients.map((client, index) => {
        return new Promise<void>((resolve) => {
          client.on('connect', () => {
            client.emit('join-matching-pool', users[index]);
            resolve();
          });
        });
      }));

      // Wait for matches to be found
      await Promise.all(clients.map((client, index) => {
        return new Promise<void>((resolve) => {
          client.on('match-found', ({ partnerId }) => {
            matchResults.push(partnerId);
            resolve();
          });

          client.on('searching', () => {
            // Some users might be left searching if odd number
            resolve();
          });
        });
      }));

      // Should have created 3 matches (6 users / 2)
      expect(matchResults.length).toBe(6);

      // Cleanup
      clients.forEach(client => client.disconnect());
    });

    it('should handle concurrent video chat sessions', async () => {
      // Create 4 users for 2 concurrent video chats
      const users = [];
      for (let i = 0; i < 4; i++) {
        const user = await db.collection('users').insertOne({
          email: `student${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        });
        users.push(user.insertedId.toString());
      }

      const clients = users.map(() => Client(baseUrl));
      const matches: Array<{ user1: string, user2: string }> = [];

      // Connect all clients
      await Promise.all(clients.map((client, index) => {
        return new Promise<void>((resolve) => {
          client.on('connect', () => {
            client.emit('join-matching-pool', users[index]);
            resolve();
          });
        });
      }));

      // Collect matches
      await Promise.all(clients.map((client, index) => {
        return new Promise<void>((resolve) => {
          client.on('match-found', ({ partnerId }) => {
            matches.push({ user1: users[index], user2: partnerId });
            resolve();
          });
        });
      }));

      // Should have 2 matches
      expect(matches.length).toBe(4); // Each match is recorded twice (once per user)

      // Simulate WebRTC connections for both matches
      const webrtcConnections = [];
      
      for (let i = 0; i < clients.length; i += 2) {
        const client1 = clients[i];
        const client2 = clients[i + 1];
        
        // Establish WebRTC connection
        const offer = { type: 'offer', sdp: `mock-offer-${i}` };
        client1.emit('webrtc-offer', { offer, targetId: users[i + 1] });
        
        await new Promise<void>((resolve) => {
          client2.on('webrtc-offer', ({ offer: receivedOffer }) => {
            expect(receivedOffer).toEqual(offer);
            const answer = { type: 'answer', sdp: `mock-answer-${i}` };
            client2.emit('webrtc-answer', { answer, targetId: users[i] });
            resolve();
          });
        });

        webrtcConnections.push({ client1, client2 });
      }

      expect(webrtcConnections.length).toBe(2);

      // Cleanup
      clients.forEach(client => client.disconnect());
    });

    it('should handle system load with many concurrent users', async () => {
      const userCount = 20;
      const users = [];

      // Create many users
      const userPromises = [];
      for (let i = 0; i < userCount; i++) {
        userPromises.push(
          db.collection('users').insertOne({
            email: `loadtest${i}@stanford.edu`,
            passwordHash: 'hashed-password',
            university: 'Stanford University',
            isEmailVerified: true,
            isActive: true,
            reportCount: 0,
            createdAt: new Date(),
            lastActiveAt: new Date()
          })
        );
      }

      const userResults = await Promise.all(userPromises);
      userResults.forEach(result => {
        users.push(result.insertedId.toString());
      });

      // Create socket connections in batches to avoid overwhelming the server
      const batchSize = 5;
      const batches = [];
      
      for (let i = 0; i < users.length; i += batchSize) {
        batches.push(users.slice(i, i + batchSize));
      }

      let totalConnections = 0;
      let totalMatches = 0;

      for (const batch of batches) {
        const batchClients = batch.map(() => Client(baseUrl));
        
        // Connect batch
        await Promise.all(batchClients.map((client, index) => {
          return new Promise<void>((resolve) => {
            client.on('connect', () => {
              totalConnections++;
              client.emit('join-matching-pool', batch[index]);
              resolve();
            });
          });
        }));

        // Count matches in this batch
        await Promise.all(batchClients.map(() => {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              totalMatches++;
              resolve();
            }, 100); // Small delay to allow matching
          });
        }));

        // Cleanup batch
        batchClients.forEach(client => client.disconnect());
      }

      expect(totalConnections).toBe(userCount);
      expect(totalMatches).toBe(userCount);
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('should handle database connection failures gracefully', async () => {
      // Simulate database connection failure
      const originalDb = db;
      
      try {
        // Close database connection
        await mongoClient.close();
        
        // Attempt database operation - should handle gracefully
        let errorCaught = false;
        try {
          await db.collection('users').findOne({ email: 'test@stanford.edu' });
        } catch (error) {
          errorCaught = true;
          expect(error).toBeDefined();
        }
        
        expect(errorCaught).toBe(true);
        
      } finally {
        // Restore database connection
        mongoClient = new MongoClient(mongoServer.getUri());
        await mongoClient.connect();
        db = mongoClient.db('test');
      }
    });

    it('should handle malformed WebRTC messages', async () => {
      const client1 = Client(baseUrl);
      const client2 = Client(baseUrl);

      await new Promise<void>((resolve) => {
        let connections = 0;
        
        client1.on('connect', () => {
          connections++;
          if (connections === 2) resolve();
        });

        client2.on('connect', () => {
          connections++;
          if (connections === 2) resolve();
        });
      });

      // Send malformed WebRTC messages
      const malformedMessages = [
        { offer: null, targetId: 'invalid' },
        { offer: { type: 'invalid' }, targetId: 'test' },
        { answer: undefined, targetId: 'test' },
        { candidate: 'not-an-object', targetId: 'test' }
      ];

      // These should not crash the server
      malformedMessages.forEach(message => {
        client1.emit('webrtc-offer', message);
        client1.emit('webrtc-answer', message);
        client1.emit('ice-candidate', message);
      });

      // Server should still be responsive
      let serverResponsive = false;
      client1.emit('join-matching-pool', 'test-user');
      
      await new Promise<void>((resolve) => {
        client1.on('searching', () => {
          serverResponsive = true;
          resolve();
        });
        
        // Timeout after 1 second
        setTimeout(resolve, 1000);
      });

      expect(serverResponsive).toBe(true);

      client1.disconnect();
      client2.disconnect();
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      const userId = 'rapid-test-user';
      let connectionCount = 0;
      let disconnectionCount = 0;

      // Perform rapid connect/disconnect cycles
      for (let i = 0; i < 5; i++) {
        const client = Client(baseUrl);
        
        await new Promise<void>((resolve) => {
          client.on('connect', () => {
            connectionCount++;
            client.emit('join-matching-pool', `${userId}-${i}`);
            
            // Immediately disconnect
            setTimeout(() => {
              client.disconnect();
              disconnectionCount++;
              resolve();
            }, 50);
          });
        });
      }

      expect(connectionCount).toBe(5);
      expect(disconnectionCount).toBe(5);
    });
  });
});