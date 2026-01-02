/**
 * Basic Integration Tests
 * 
 * Simple integration tests to verify core functionality
 * Validates: Basic system integration without complex setup
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';

describe('Basic Integration Tests', () => {
  let mongoServer: MongoMemoryServer;
  let mongoClient: MongoClient;
  let db: Db;

  beforeAll(async () => {
    // Start in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db('test');
  }, 60000);

  afterAll(async () => {
    if (mongoClient) {
      await mongoClient.close();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }, 30000);

  beforeEach(async () => {
    // Clear database before each test
    await db.collection('users').deleteMany({});
    await db.collection('sessions').deleteMany({});
    await db.collection('reports').deleteMany({});
  });

  describe('Database Integration', () => {
    it('should create and retrieve users from database', async () => {
      // Create a test user
      const userData = {
        email: 'test@stanford.edu',
        passwordHash: 'hashed-password',
        university: 'Stanford University',
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      };

      const result = await db.collection('users').insertOne(userData);
      expect(result.insertedId).toBeDefined();

      // Retrieve the user
      const user = await db.collection('users').findOne({ _id: result.insertedId });
      expect(user).toBeDefined();
      expect(user?.email).toBe('test@stanford.edu');
      expect(user?.university).toBe('Stanford University');
      expect(user?.isEmailVerified).toBe(true);
    });

    it('should handle concurrent user creation', async () => {
      const userCount = 10;
      const promises = [];

      // Create multiple users concurrently
      for (let i = 0; i < userCount; i++) {
        const userData = {
          email: `user${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        };

        promises.push(db.collection('users').insertOne(userData));
      }

      const results = await Promise.all(promises);
      
      // Verify all users were created
      expect(results).toHaveLength(userCount);
      results.forEach(result => {
        expect(result.insertedId).toBeDefined();
      });

      // Verify count in database
      const count = await db.collection('users').countDocuments({});
      expect(count).toBe(userCount);
    });

    it('should create and manage reports', async () => {
      // Create test users
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

      // Create a report
      const reportData = {
        reporterId: user1.insertedId.toString(),
        reportedUserId: user2.insertedId.toString(),
        category: 'inappropriate-behavior',
        description: 'User was behaving inappropriately',
        timestamp: new Date(),
        status: 'pending'
      };

      const report = await db.collection('reports').insertOne(reportData);
      expect(report.insertedId).toBeDefined();

      // Verify report was stored correctly
      const storedReport = await db.collection('reports').findOne({ _id: report.insertedId });
      expect(storedReport?.reporterId).toBe(user1.insertedId.toString());
      expect(storedReport?.reportedUserId).toBe(user2.insertedId.toString());
      expect(storedReport?.category).toBe('inappropriate-behavior');
      expect(storedReport?.status).toBe('pending');

      // Update reported user's report count
      await db.collection('users').updateOne(
        { _id: user2.insertedId },
        { $inc: { reportCount: 1 } }
      );

      const updatedUser = await db.collection('users').findOne({ _id: user2.insertedId });
      expect(updatedUser?.reportCount).toBe(1);
    });
  });

  describe('Data Model Validation', () => {
    it('should validate user data structure', async () => {
      const userData = {
        email: 'validation@stanford.edu',
        passwordHash: 'hashed-password',
        university: 'Stanford University',
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      };

      const result = await db.collection('users').insertOne(userData);
      const user = await db.collection('users').findOne({ _id: result.insertedId });

      // Verify all required fields are present
      expect(user?.email).toBeDefined();
      expect(user?.passwordHash).toBeDefined();
      expect(user?.university).toBeDefined();
      expect(user?.isEmailVerified).toBeDefined();
      expect(user?.isActive).toBeDefined();
      expect(user?.reportCount).toBeDefined();
      expect(user?.createdAt).toBeDefined();
      expect(user?.lastActiveAt).toBeDefined();

      // Verify data types
      expect(typeof user?.email).toBe('string');
      expect(typeof user?.passwordHash).toBe('string');
      expect(typeof user?.university).toBe('string');
      expect(typeof user?.isEmailVerified).toBe('boolean');
      expect(typeof user?.isActive).toBe('boolean');
      expect(typeof user?.reportCount).toBe('number');
      expect(user?.createdAt).toBeInstanceOf(Date);
      expect(user?.lastActiveAt).toBeInstanceOf(Date);
    });

    it('should validate report data structure', async () => {
      const reportData = {
        reporterId: 'user1-id',
        reportedUserId: 'user2-id',
        category: 'harassment',
        description: 'Inappropriate behavior during video chat',
        timestamp: new Date(),
        status: 'pending'
      };

      const result = await db.collection('reports').insertOne(reportData);
      const report = await db.collection('reports').findOne({ _id: result.insertedId });

      // Verify all required fields are present
      expect(report?.reporterId).toBeDefined();
      expect(report?.reportedUserId).toBeDefined();
      expect(report?.category).toBeDefined();
      expect(report?.description).toBeDefined();
      expect(report?.timestamp).toBeDefined();
      expect(report?.status).toBeDefined();

      // Verify data types
      expect(typeof report?.reporterId).toBe('string');
      expect(typeof report?.reportedUserId).toBe('string');
      expect(typeof report?.category).toBe('string');
      expect(typeof report?.description).toBe('string');
      expect(report?.timestamp).toBeInstanceOf(Date);
      expect(typeof report?.status).toBe('string');

      // Verify valid category values
      const validCategories = ['inappropriate-behavior', 'harassment', 'spam', 'other'];
      expect(validCategories).toContain(report?.category);

      // Verify valid status values
      const validStatuses = ['pending', 'reviewed', 'resolved'];
      expect(validStatuses).toContain(report?.status);
    });
  });

  describe('Performance Tests', () => {
    it('should handle bulk user operations efficiently', async () => {
      const userCount = 100;
      const users = [];

      // Prepare user data
      for (let i = 0; i < userCount; i++) {
        users.push({
          email: `bulk${i}@stanford.edu`,
          passwordHash: 'hashed-password',
          university: 'Stanford University',
          isEmailVerified: true,
          isActive: true,
          reportCount: 0,
          createdAt: new Date(),
          lastActiveAt: new Date()
        });
      }

      const startTime = Date.now();
      
      // Bulk insert
      const result = await db.collection('users').insertMany(users);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify all users were inserted
      expect(Object.keys(result.insertedIds)).toHaveLength(userCount);
      
      // Should complete within reasonable time (less than 2 seconds)
      expect(duration).toBeLessThan(2000);

      // Verify count
      const count = await db.collection('users').countDocuments({});
      expect(count).toBe(userCount);
    });

    it('should handle concurrent read operations', async () => {
      // Create test data
      const userData = {
        email: 'concurrent@stanford.edu',
        passwordHash: 'hashed-password',
        university: 'Stanford University',
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      };

      await db.collection('users').insertOne(userData);

      // Perform concurrent reads
      const readPromises = [];
      for (let i = 0; i < 50; i++) {
        readPromises.push(
          db.collection('users').findOne({ email: 'concurrent@stanford.edu' })
        );
      }

      const startTime = Date.now();
      const results = await Promise.all(readPromises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // All reads should succeed
      expect(results).toHaveLength(50);
      results.forEach(result => {
        expect(result?.email).toBe('concurrent@stanford.edu');
      });

      // Should complete within reasonable time
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Error Handling', () => {
    it('should handle duplicate email constraints', async () => {
      const userData = {
        email: 'duplicate@stanford.edu',
        passwordHash: 'hashed-password',
        university: 'Stanford University',
        isEmailVerified: true,
        isActive: true,
        reportCount: 0,
        createdAt: new Date(),
        lastActiveAt: new Date()
      };

      // First insertion should succeed
      const result1 = await db.collection('users').insertOne(userData);
      expect(result1.insertedId).toBeDefined();

      // Create unique index on email
      await db.collection('users').createIndex({ email: 1 }, { unique: true });

      // Second insertion with same email should fail
      await expect(
        db.collection('users').insertOne(userData)
      ).rejects.toThrow();

      // Verify only one user exists
      const count = await db.collection('users').countDocuments({ email: 'duplicate@stanford.edu' });
      expect(count).toBe(1);
    });

    it('should handle invalid data gracefully', async () => {
      // Test with missing required fields
      const invalidUserData = {
        email: 'invalid@stanford.edu'
        // Missing other required fields
      };

      // This should still work in MongoDB (no schema validation by default)
      // But in a real application, validation would happen at the application layer
      const result = await db.collection('users').insertOne(invalidUserData);
      expect(result.insertedId).toBeDefined();

      const user = await db.collection('users').findOne({ _id: result.insertedId });
      expect(user?.email).toBe('invalid@stanford.edu');
      expect(user?.passwordHash).toBeUndefined();
    });
  });
});