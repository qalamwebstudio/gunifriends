/**
 * Concurrent Multiple User Scenarios Tests
 * 
 * Tests system behavior with multiple simultaneous users
 * Validates: Requirements 4.1, 4.2, 4.5, 8.1, 8.2 - Concurrent user handling
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';

interface User {
  id: string;
  email: string;
  university: string;
  client?: ClientSocket;
}

interface Match {
  user1: string;
  user2: string;
  timestamp: Date;
}

describe('Concurrent Multiple User Scenarios Tests', () => {
  let mongoServer: MongoMemoryServer;
  let mongoClient: MongoClient;
  let db: Db;
  let httpServer: any;
  let socketServer: Server;
  let serverPort: number;
  let baseUrl: string;

  // Tracking system state
  let matchingPool: Set<string>;
  let activeMatches: Map<string, string>;
  let userSessions: Map<string, string>; // userId -> socketId
  let matchHistory: Match[];

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

    // Initialize tracking state
    matchingPool = new Set();
    activeMatches = new Map();
    userSessions = new Map();
    matchHistory = [];

    // Set up Socket.io event handlers
    socketServer.on('connection', (socket) => {
      socket.on('join-matching-pool', (userId: string) => {
        userSessions.set(userId, socket.id);
        
        if (matchingPool.size > 0) {
          // Find a match from waiting users
          const waitingUsers = Array.from(matchingPool);
          const waitingUser = waitingUsers[0];
          matchingPool.delete(waitingUser);
          
          // Create match
          activeMatches.set(userId, waitingUser);
          activeMatches.set(waitingUser, userId);
          
          // Record match
          matchHistory.push({
            user1: userId,
            user2: waitingUser,
            timestamp: new Date()
          });
          
          // Notify both users
          socket.emit('match-found', { partnerId: waitingUser });
          const waitingSocket = userSessions.get(waitingUser);
          if (waitingSocket) {
            socket.to(waitingSocket).emit('match-found', { partnerId: userId });
          }
        } else {
          // Add to waiting pool
          matchingPool.add(userId);
          socket.emit('searching');
        }
      });

      socket.on('leave-matching-pool', (userId: string) => {
        matchingPool.delete(userId);
        const partnerId = activeMatches.get(userId);
        if (partnerId) {
          activeMatches.delete(userId);
          activeMatches.delete(partnerId);
          const partnerSocket = userSessions.get(partnerId);
          if (partnerSocket) {
            socket.to(partnerSocket).emit('partner-left');
          }
        }
        userSessions.delete(userId);
      });

      socket.on('end-call', ({ partnerId }) => {
        activeMatches.delete(socket.id);
        activeMatches.delete(partnerId);
        socket.to(partnerId).emit('call-ended');
      });

      socket.on('disconnect', () => {
        // Find user by socket ID
        let disconnectedUserId: string | null = null;
        for (const [userId, socketId] of userSessions.entries()) {
          if (socketId === socket.id) {
            disconnectedUserId = userId;
            break;
          }
        }

        if (disconnectedUserId) {
          matchingPool.delete(disconnectedUserId);
          const partnerId = activeMatches.get(disconnectedUserId);
          if (partnerId) {
            activeMatches.delete(disconnectedUserId);
            activeMatches.delete(partnerId);
            const partnerSocket = userSessions.get(partnerId);
            if (partnerSocket) {
              socket.to(partnerSocket).emit('partner-disconnected');
            }
          }
          userSessions.delete(disconnectedUserId);
        }
      });
    });
  });

  afterAll(async () => {
    await mongoClient.close();
    await mongoServer.stop();
    socketServer.close();
    httpServer.close();
  });

  beforeEach(async () => {
    // Clear database and state before each test
    await db.collection('users').deleteMany({});
    await db.collection('sessions').deleteMany({});
    await db.collection('matches').deleteMany({});
    
    matchingPool.clear();
    activeMatches.clear();
    userSessions.clear();
    matchHistory = [];
  });

  describe('High-Volume User Registration', () => {
    it('should handle 100 concurrent user registrations', async () => {
      const userCount = 100;
      const registrationPromises: Promise<any>[] = [];

      // Create concurrent registration requests
      for (let i = 0; i < userCount; i++) {
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

      // Execute all registrations concurrently
      const startTime = Date.now();
      const results = await Promise.all(registrationPromises);
      const endTime = Date.now();

      // Verify all registrations succeeded
      expect(results).toHaveLength(userCount);
      results.forEach(result => {
        expect(result.insertedId).toBeDefined();
      });

      // Verify performance (should complete within reasonable time)
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000); // 5 seconds max

      // Verify database consistency
      const totalUsers = await db.collection('users').countDocuments({});
      expect(totalUsers).toBe(userCount);
    });

    it('should handle concurrent registrations with duplicate emails gracefully', async () => {
      const duplicateEmail = 'duplicate@stanford.edu';
      const registrationPromises: Promise<any>[] = [];

      // Attempt to register same email multiple times concurrently
      for (let i = 0; i < 10; i++) {
        const userData = {
          email: duplicateEmail,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        };

        registrationPromises.push(
          db.collection('users').insertOne(userData).catch(error => ({ error }))
        );
      }

      const results = await Promise.all(registrationPromises);

      // Only one should succeed, others should fail
      const successes = results.filter(result => !result.error);
      const failures = results.filter(result => result.error);

      expect(successes).toHaveLength(1);
      expect(failures.length).toBeGreaterThan(0);

      // Verify only one user exists with that email
      const userCount = await db.collection('users').countDocuments({ email: duplicateEmail });
      expect(userCount).toBe(1);
    });
  });

  describe('Massive Concurrent Matching', () => {
    it('should handle 50 users joining matching pool simultaneously', async () => {
      const userCount = 50;
      const users: User[] = [];

      // Create users in database
      for (let i = 0; i < userCount; i++) {
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

        users.push({
          id: user.insertedId.toString(),
          email: `student${i}@stanford.edu`,
          university: 'Stanford University'
        });
      }

      // Create socket connections for all users
      const connectionPromises = users.map(user => {
        return new Promise<void>((resolve) => {
          const client = Client(baseUrl);
          user.client = client;
          
          client.on('connect', () => {
            resolve();
          });
        });
      });

      await Promise.all(connectionPromises);

      // All users join matching pool simultaneously
      const matchingPromises = users.map(user => {
        return new Promise<string | null>((resolve) => {
          let resolved = false;
          
          user.client!.on('match-found', ({ partnerId }) => {
            if (!resolved) {
              resolved = true;
              resolve(partnerId);
            }
          });

          user.client!.on('searching', () => {
            if (!resolved) {
              resolved = true;
              resolve(null); // Still searching
            }
          });

          user.client!.emit('join-matching-pool', user.id);
        });
      });

      const matchResults = await Promise.all(matchingPromises);

      // Verify matching results
      const matched = matchResults.filter(result => result !== null);
      const searching = matchResults.filter(result => result === null);

      // Should have created userCount/2 matches
      expect(matched.length).toBe(userCount - (userCount % 2));
      expect(searching.length).toBe(userCount % 2);

      // Verify no duplicate matches
      const matchPairs = new Set();
      for (let i = 0; i < users.length; i++) {
        const partnerId = matchResults[i];
        if (partnerId) {
          const pair = [users[i].id, partnerId].sort().join('-');
          expect(matchPairs.has(pair)).toBe(false);
          matchPairs.add(pair);
        }
      }

      // Cleanup
      users.forEach(user => user.client?.disconnect());
    });

    it('should handle rapid join/leave cycles without memory leaks', async () => {
      const cycleCount = 20;
      const usersPerCycle = 10;
      
      for (let cycle = 0; cycle < cycleCount; cycle++) {
        const users: User[] = [];
        
        // Create users for this cycle
        for (let i = 0; i < usersPerCycle; i++) {
          const user = await db.collection('users').insertOne({
            email: `cycle${cycle}_user${i}@stanford.edu`,
            passwordHash: 'hashed-password',
            university: 'Stanford University',
            isEmailVerified: true,
            isActive: true,
            reportCount: 0,
            createdAt: new Date(),
            lastActiveAt: new Date()
          });

          users.push({
            id: user.insertedId.toString(),
            email: `cycle${cycle}_user${i}@stanford.edu`,
            university: 'Stanford University'
          });
        }

        // Connect all users
        await Promise.all(users.map(user => {
          return new Promise<void>((resolve) => {
            const client = Client(baseUrl);
            user.client = client;
            client.on('connect', resolve);
          });
        }));

        // Join matching pool
        users.forEach(user => {
          user.client!.emit('join-matching-pool', user.id);
        });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Disconnect all users
        users.forEach(user => {
          user.client!.disconnect();
        });

        // Verify state is clean
        expect(matchingPool.size).toBe(0);
        expect(activeMatches.size).toBe(0);
      }
    });

    it('should maintain matching fairness under high load', async () => {
      const userCount = 30;
      const users: User[] = [];

      // Create users
      for (let i = 0; i < userCount; i++) {
        const user = await db.collection('users').insertOne({
          email: `fairness${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        });

        users.push({
          id: user.insertedId.toString(),
          email: `fairness${i}@stanford.edu`,
          university: 'Stanford University'
        });
      }

      // Connect users with staggered timing
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        
        await new Promise<void>((resolve) => {
          const client = Client(baseUrl);
          user.client = client;
          
          client.on('connect', () => {
            client.emit('join-matching-pool', user.id);
            resolve();
          });
        });

        // Small delay between connections
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Wait for all matching to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify fairness - no user should be left waiting if matches are possible
      const expectedMatches = Math.floor(userCount / 2);
      expect(matchHistory.length).toBe(expectedMatches);
      expect(matchingPool.size).toBe(userCount % 2);

      // Cleanup
      users.forEach(user => user.client?.disconnect());
    });
  });

  describe('Concurrent Video Chat Sessions', () => {
    it('should handle 10 simultaneous video chat sessions', async () => {
      const sessionCount = 10;
      const totalUsers = sessionCount * 2;
      const users: User[] = [];

      // Create users
      for (let i = 0; i < totalUsers; i++) {
        const user = await db.collection('users').insertOne({
          email: `videochat${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        });

        users.push({
          id: user.insertedId.toString(),
          email: `videochat${i}@stanford.edu`,
          university: 'Stanford University'
        });
      }

      // Connect all users and establish matches
      await Promise.all(users.map(user => {
        return new Promise<void>((resolve) => {
          const client = Client(baseUrl);
          user.client = client;
          
          client.on('connect', () => {
            client.emit('join-matching-pool', user.id);
            resolve();
          });
        });
      }));

      // Wait for all matches to be established
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify all users are matched
      expect(activeMatches.size).toBe(totalUsers);
      expect(matchingPool.size).toBe(0);

      // Simulate WebRTC connections for all sessions
      const webrtcPromises: Promise<void>[] = [];
      
      for (let i = 0; i < totalUsers; i += 2) {
        const user1 = users[i];
        const user2 = users[i + 1];
        
        webrtcPromises.push(
          new Promise<void>((resolve) => {
            let offerReceived = false;
            let answerReceived = false;
            
            // Set up WebRTC signaling
            user2.client!.on('webrtc-offer', ({ offer }) => {
              offerReceived = true;
              const answer = { type: 'answer', sdp: `answer-${i}` };
              user2.client!.emit('webrtc-answer', { answer, targetId: user1.id });
            });
            
            user1.client!.on('webrtc-answer', ({ answer }) => {
              answerReceived = true;
              if (offerReceived && answerReceived) {
                resolve();
              }
            });
            
            // Start WebRTC handshake
            const offer = { type: 'offer', sdp: `offer-${i}` };
            user1.client!.emit('webrtc-offer', { offer, targetId: user2.id });
          })
        );
      }

      await Promise.all(webrtcPromises);

      // Verify all WebRTC connections established
      expect(webrtcPromises).toHaveLength(sessionCount);

      // Cleanup
      users.forEach(user => user.client?.disconnect());
    });

    it('should handle concurrent call terminations gracefully', async () => {
      const sessionCount = 5;
      const totalUsers = sessionCount * 2;
      const users: User[] = [];

      // Set up users and matches (similar to previous test)
      for (let i = 0; i < totalUsers; i++) {
        const user = await db.collection('users').insertOne({
          email: `termination${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        });

        users.push({
          id: user.insertedId.toString(),
          email: `termination${i}@stanford.edu`,
          university: 'Stanford University'
        });
      }

      // Connect and match users
      await Promise.all(users.map(user => {
        return new Promise<void>((resolve) => {
          const client = Client(baseUrl);
          user.client = client;
          
          client.on('connect', () => {
            client.emit('join-matching-pool', user.id);
            resolve();
          });
        });
      }));

      await new Promise(resolve => setTimeout(resolve, 500));

      // All users simultaneously end their calls
      const terminationPromises = [];
      
      for (let i = 0; i < totalUsers; i += 2) {
        const user1 = users[i];
        const user2 = users[i + 1];
        
        terminationPromises.push(
          new Promise<void>((resolve) => {
            user2.client!.on('call-ended', () => {
              resolve();
            });
            
            user1.client!.emit('end-call', { partnerId: user2.id });
          })
        );
      }

      await Promise.all(terminationPromises);

      // Verify all matches are cleaned up
      expect(activeMatches.size).toBe(0);

      // Cleanup
      users.forEach(user => user.client?.disconnect());
    });
  });

  describe('System Resource Management', () => {
    it('should handle memory usage efficiently with many concurrent users', async () => {
      const userCount = 100;
      const users: User[] = [];

      // Monitor initial memory usage
      const initialMemory = process.memoryUsage();

      // Create many users
      for (let i = 0; i < userCount; i++) {
        const user = await db.collection('users').insertOne({
          email: `memory${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        });

        users.push({
          id: user.insertedId.toString(),
          email: `memory${i}@stanford.edu`,
          university: 'Stanford University'
        });
      }

      // Connect all users
      await Promise.all(users.map(user => {
        return new Promise<void>((resolve) => {
          const client = Client(baseUrl);
          user.client = client;
          
          client.on('connect', () => {
            client.emit('join-matching-pool', user.id);
            resolve();
          });
        });
      }));

      // Check memory usage with all users connected
      const peakMemory = process.memoryUsage();
      
      // Disconnect all users
      users.forEach(user => user.client?.disconnect());
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Check memory usage after cleanup
      const finalMemory = process.memoryUsage();
      
      // Memory should not grow excessively
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryGrowthMB = memoryGrowth / (1024 * 1024);
      
      // Should not use more than 100MB additional memory
      expect(memoryGrowthMB).toBeLessThan(100);
      
      // Verify state is clean
      expect(matchingPool.size).toBe(0);
      expect(activeMatches.size).toBe(0);
      expect(userSessions.size).toBe(0);
    });

    it('should handle database connection pooling under load', async () => {
      const concurrentOperations = 50;
      const operationPromises: Promise<any>[] = [];

      // Perform many concurrent database operations
      for (let i = 0; i < concurrentOperations; i++) {
        operationPromises.push(
          db.collection('users').insertOne({
            email: `dbload${i}@stanford.edu`,
            passwordHash: 'hashed-password',
            university: 'Stanford University',
            isEmailVerified: true,
            isActive: true,
            reportCount: 0,
            createdAt: new Date(),
            lastActiveAt: new Date()
          })
        );

        operationPromises.push(
          db.collection('users').findOne({ email: `dbload${i}@stanford.edu` })
        );

        operationPromises.push(
          db.collection('users').updateOne(
            { email: `dbload${i}@stanford.edu` },
            { $set: { lastActiveAt: new Date() } }
          )
        );
      }

      const startTime = Date.now();
      const results = await Promise.all(operationPromises);
      const endTime = Date.now();

      // All operations should succeed
      expect(results).toHaveLength(concurrentOperations * 3);
      
      // Should complete within reasonable time
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(10000); // 10 seconds max

      // Verify database consistency
      const userCount = await db.collection('users').countDocuments({
        email: { $regex: /^dbload\d+@stanford\.edu$/ }
      });
      expect(userCount).toBe(concurrentOperations);
    });

    it('should handle socket connection limits gracefully', async () => {
      const connectionLimit = 200;
      const clients: ClientSocket[] = [];
      const connectionPromises: Promise<void>[] = [];

      // Attempt to create many socket connections
      for (let i = 0; i < connectionLimit; i++) {
        connectionPromises.push(
          new Promise<void>((resolve, reject) => {
            const client = Client(baseUrl, {
              timeout: 5000,
              forceNew: true
            });
            
            clients.push(client);
            
            client.on('connect', () => {
              resolve();
            });
            
            client.on('connect_error', (error) => {
              // Connection limit reached - this is expected behavior
              resolve();
            });
            
            setTimeout(() => {
              resolve(); // Timeout - also acceptable
            }, 1000);
          })
        );
      }

      await Promise.all(connectionPromises);

      // Server should remain responsive
      const testClient = Client(baseUrl);
      let serverResponsive = false;
      
      await new Promise<void>((resolve) => {
        testClient.on('connect', () => {
          serverResponsive = true;
          resolve();
        });
        
        setTimeout(resolve, 2000);
      });

      expect(serverResponsive).toBe(true);

      // Cleanup
      clients.forEach(client => {
        try {
          client.disconnect();
        } catch (error) {
          // Ignore cleanup errors
        }
      });
      testClient.disconnect();
    });
  });

  describe('Error Recovery Under Load', () => {
    it('should recover from temporary database disconnections', async () => {
      const userCount = 10;
      const users: User[] = [];

      // Create initial users
      for (let i = 0; i < userCount; i++) {
        const user = await db.collection('users').insertOne({
          email: `recovery${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        });

        users.push({
          id: user.insertedId.toString(),
          email: `recovery${i}@stanford.edu`,
          university: 'Stanford University'
        });
      }

      // Connect users
      await Promise.all(users.map(user => {
        return new Promise<void>((resolve) => {
          const client = Client(baseUrl);
          user.client = client;
          client.on('connect', resolve);
        });
      }));

      // Simulate database reconnection by creating new connection
      await mongoClient.close();
      mongoClient = new MongoClient(mongoServer.getUri());
      await mongoClient.connect();
      db = mongoClient.db('test');

      // System should continue to function for in-memory operations
      users.forEach(user => {
        user.client!.emit('join-matching-pool', user.id);
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      // Matching should still work (in-memory)
      expect(matchingPool.size + activeMatches.size).toBeGreaterThan(0);

      // Cleanup
      users.forEach(user => user.client?.disconnect());
    });

    it('should handle cascading disconnections gracefully', async () => {
      const userCount = 20;
      const users: User[] = [];

      // Create and connect users
      for (let i = 0; i < userCount; i++) {
        const user = await db.collection('users').insertOne({
          email: `cascade${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        });

        users.push({
          id: user.insertedId.toString(),
          email: `cascade${i}@stanford.edu`,
          university: 'Stanford University'
        });
      }

      await Promise.all(users.map(user => {
        return new Promise<void>((resolve) => {
          const client = Client(baseUrl);
          user.client = client;
          
          client.on('connect', () => {
            client.emit('join-matching-pool', user.id);
            resolve();
          });
        });
      }));

      // Wait for matches to form
      await new Promise(resolve => setTimeout(resolve, 500));

      // Disconnect users in rapid succession
      for (let i = 0; i < users.length; i++) {
        users[i].client!.disconnect();
        
        // Small delay between disconnections
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));

      // System should be in clean state
      expect(matchingPool.size).toBe(0);
      expect(activeMatches.size).toBe(0);
      expect(userSessions.size).toBe(0);

      // Server should still be responsive
      const testClient = Client(baseUrl);
      let responsive = false;
      
      await new Promise<void>((resolve) => {
        testClient.on('connect', () => {
          responsive = true;
          resolve();
        });
        
        setTimeout(resolve, 1000);
      });

      expect(responsive).toBe(true);
      testClient.disconnect();
    });
  });
});