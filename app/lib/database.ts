import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { User, Session, Report, Match } from '../types';

// MongoDB Database Implementation
class MongoDatabase {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private users: Collection<User> | null = null;
  private sessions: Collection<Session> | null = null;
  private reports: Collection<Report> | null = null;
  private matches: Collection<Match> | null = null;

  async connect(): Promise<void> {
    if (this.client) return; // Already connected

    const uri = process.env.MONGODB_URI;
    const dbName = process.env.DATABASE_NAME || 'university_video_chat';

    if (!uri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    try {
      this.client = new MongoClient(uri);
      await this.client.connect();
      this.db = this.client.db(dbName);
      
      // Initialize collections
      this.users = this.db.collection<User>('users');
      this.sessions = this.db.collection<Session>('sessions');
      this.reports = this.db.collection<Report>('reports');
      this.matches = this.db.collection<Match>('matches');

      // Create indexes for better performance
      await this.createIndexes();
      
      console.log('✅ Connected to MongoDB successfully');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  private async createIndexes(): Promise<void> {
    if (!this.users || !this.sessions) return;

    try {
      // Create unique index on email for users
      await this.users.createIndex({ email: 1 }, { unique: true });
      
      // Create index on emailVerificationToken for faster lookups
      await this.users.createIndex({ emailVerificationToken: 1 }, { sparse: true });
      
      // Create index on userId for sessions
      await this.sessions.createIndex({ userId: 1 });
      
      // Create index on status for sessions
      await this.sessions.createIndex({ status: 1 });
      
      console.log('✅ Database indexes created successfully');
    } catch (error) {
      console.error('⚠️ Warning: Failed to create some indexes:', error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.users = null;
      this.sessions = null;
      this.reports = null;
      this.matches = null;
      console.log('✅ Disconnected from MongoDB');
    }
  }

  private async ensureConnection(): Promise<void> {
    if (!this.client || !this.db) {
      await this.connect();
    }
  }

  // User operations
  async createUser(user: Omit<User, 'id' | 'createdAt' | 'lastActiveAt'>): Promise<User> {
    await this.ensureConnection();
    if (!this.users) throw new Error('Users collection not initialized');

    const now = new Date();
    const newUser: User = {
      ...user,
      id: new ObjectId().toString(),
      createdAt: now,
      lastActiveAt: now,
    };
    
    try {
      await this.users.insertOne(newUser);
      return newUser;
    } catch (error: any) {
      if (error.code === 11000) { // Duplicate key error
        throw new Error('An account with this email already exists');
      }
      throw error;
    }
  }

  async getUserById(id: string): Promise<User | null> {
    await this.ensureConnection();
    if (!this.users) throw new Error('Users collection not initialized');

    const user = await this.users.findOne({ id });
    return user || null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    await this.ensureConnection();
    if (!this.users) throw new Error('Users collection not initialized');

    const user = await this.users.findOne({ email: email.toLowerCase() });
    return user || null;
  }

  async getUserByVerificationToken(token: string): Promise<User | null> {
    await this.ensureConnection();
    if (!this.users) throw new Error('Users collection not initialized');

    const user = await this.users.findOne({ emailVerificationToken: token });
    return user || null;
  }

  async getUserByPasswordResetToken(token: string): Promise<User | null> {
    await this.ensureConnection();
    if (!this.users) throw new Error('Users collection not initialized');

    const user = await this.users.findOne({ 
      passwordResetToken: token,
      passwordResetExpiresAt: { $gt: new Date() }
    });
    return user || null;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    await this.ensureConnection();
    if (!this.users) throw new Error('Users collection not initialized');
    
    const result = await this.users.findOneAndUpdate(
      { id },
      { $set: updates },
      { returnDocument: 'after' }
    );
    
    return result || null;
  }

  // Session operations
  async createSession(session: Omit<Session, 'id' | 'joinedAt' | 'lastActivity'>): Promise<Session> {
    await this.ensureConnection();
    if (!this.sessions) throw new Error('Sessions collection not initialized');

    const now = new Date();
    const newSession: Session = {
      ...session,
      id: new ObjectId().toString(),
      joinedAt: now,
      lastActivity: now,
    };
    
    await this.sessions.insertOne(newSession);
    return newSession;
  }

  async getSessionByUserId(userId: string): Promise<Session | null> {
    await this.ensureConnection();
    if (!this.sessions) throw new Error('Sessions collection not initialized');

    const session = await this.sessions.findOne({ userId });
    return session || null;
  }

  async updateSession(id: string, updates: Partial<Session>): Promise<Session | null> {
    await this.ensureConnection();
    if (!this.sessions) throw new Error('Sessions collection not initialized');
    
    const result = await this.sessions.findOneAndUpdate(
      { id },
      { $set: { ...updates, lastActivity: new Date() } },
      { returnDocument: 'after' }
    );
    
    return result || null;
  }

  async deleteSession(id: string): Promise<boolean> {
    await this.ensureConnection();
    if (!this.sessions) throw new Error('Sessions collection not initialized');

    const result = await this.sessions.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async getWaitingSessions(): Promise<Session[]> {
    await this.ensureConnection();
    if (!this.sessions) throw new Error('Sessions collection not initialized');

    const sessions = await this.sessions.find({ status: 'waiting' }).toArray();
    return sessions;
  }

  // Report operations
  async createReport(report: Omit<Report, 'id' | 'timestamp'>): Promise<Report> {
    await this.ensureConnection();
    if (!this.reports) throw new Error('Reports collection not initialized');

    const newReport: Report = {
      ...report,
      id: new ObjectId().toString(),
      timestamp: new Date(),
    };
    
    await this.reports.insertOne(newReport);
    return newReport;
  }

  async getReportsByUserId(userId: string): Promise<Report[]> {
    await this.ensureConnection();
    if (!this.reports) throw new Error('Reports collection not initialized');

    const reports = await this.reports.find({ reportedUserId: userId }).toArray();
    return reports;
  }

  // Match operations
  async createMatch(match: Omit<Match, 'id' | 'startedAt'>): Promise<Match> {
    await this.ensureConnection();
    if (!this.matches) throw new Error('Matches collection not initialized');

    const newMatch: Match = {
      ...match,
      id: new ObjectId().toString(),
      startedAt: new Date(),
    };
    
    await this.matches.insertOne(newMatch);
    return newMatch;
  }

  async updateMatch(id: string, updates: Partial<Match>): Promise<Match | null> {
    await this.ensureConnection();
    if (!this.matches) throw new Error('Matches collection not initialized');
    
    const result = await this.matches.findOneAndUpdate(
      { id },
      { $set: updates },
      { returnDocument: 'after' }
    );
    
    return result || null;
  }

  // Utility methods for testing
  async clearAll(): Promise<void> {
    await this.ensureConnection();
    if (!this.users || !this.sessions || !this.reports || !this.matches) {
      throw new Error('Collections not initialized');
    }

    await Promise.all([
      this.users.deleteMany({}),
      this.sessions.deleteMany({}),
      this.reports.deleteMany({}),
      this.matches.deleteMany({})
    ]);
  }

  async getAllUsers(): Promise<User[]> {
    await this.ensureConnection();
    if (!this.users) throw new Error('Users collection not initialized');

    const users = await this.users.find({}).toArray();
    return users;
  }

  // Health check
  async ping(): Promise<boolean> {
    try {
      await this.ensureConnection();
      if (!this.db) return false;
      
      await this.db.admin().ping();
      return true;
    } catch (error) {
      console.error('Database ping failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const db = new MongoDatabase();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await db.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await db.disconnect();
  process.exit(0);
});