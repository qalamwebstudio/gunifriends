import { Session, Match } from '../types';
import crypto from 'crypto';

/**
 * Matching Service for pairing students randomly
 */
export class MatchingService {
  private matchingPool: Set<string>;
  private activeSessions: Map<string, Session>;
  private activeMatches: Map<string, Match>;

  constructor(matchingPool: Set<string>, activeSessions: Map<string, Session>) {
    this.matchingPool = matchingPool;
    this.activeSessions = activeSessions;
    this.activeMatches = new Map();
  }

  /**
   * Add user to matching pool
   * Requirements: 4.1 - When a student initiates matching, add them to available pool
   */
  addToPool(userId: string): boolean {
    try {
      const session = this.activeSessions.get(userId);
      if (!session) {
        console.error(`No session found for user ${userId}`);
        return false;
      }

      // Prevent adding user if already in pool or in call
      if (session.status === 'matched' || session.status === 'in-call') {
        console.log(`User ${userId} already matched or in call`);
        return false;
      }

      // Add to pool and update session status
      this.matchingPool.add(userId);
      session.status = 'waiting';
      session.lastActivity = new Date();

      console.log(`User ${userId} added to matching pool. Pool size: ${this.matchingPool.size}`);
      return true;
    } catch (error) {
      console.error(`Error adding user ${userId} to pool:`, error);
      return false;
    }
  }

  /**
   * Remove user from matching pool
   */
  removeFromPool(userId: string): boolean {
    try {
      const removed = this.matchingPool.delete(userId);
      
      const session = this.activeSessions.get(userId);
      if (session && session.status === 'waiting') {
        session.status = 'waiting'; // Keep as waiting but not in pool
      }

      console.log(`User ${userId} removed from matching pool. Pool size: ${this.matchingPool.size}`);
      return removed;
    } catch (error) {
      console.error(`Error removing user ${userId} from pool:`, error);
      return false;
    }
  }

  /**
   * Find a match for the given user
   * Requirements: 4.2 - When two students are searching, pair them randomly
   * Requirements: 4.5 - Ensure no student is matched with themselves
   */
  findMatch(userId: string): string | null {
    try {
      // Remove the requesting user from pool first
      this.matchingPool.delete(userId);

      // Get available users (excluding the requesting user)
      const availableUsers = Array.from(this.matchingPool).filter(id => id !== userId);
      
      if (availableUsers.length === 0) {
        // No one available, add user back to pool
        this.matchingPool.add(userId);
        return null;
      }

      // Randomly select a partner
      const randomIndex = Math.floor(Math.random() * availableUsers.length);
      const partnerId = availableUsers[randomIndex];

      // Remove partner from pool
      this.matchingPool.delete(partnerId);

      console.log(`Match found: ${userId} <-> ${partnerId}`);
      return partnerId;
    } catch (error) {
      console.error(`Error finding match for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Create a match between two users
   * Requirements: 4.4 - When match is found, connect both students to video chat
   */
  createMatch(user1Id: string, user2Id: string): Match | null {
    try {
      const session1 = this.activeSessions.get(user1Id);
      const session2 = this.activeSessions.get(user2Id);

      if (!session1 || !session2) {
        console.error(`Sessions not found for match: ${user1Id}, ${user2Id}`);
        return null;
      }

      // Generate unique room ID for the match
      const roomId = `room_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

      // Create match record
      const match: Match = {
        id: roomId,
        user1Id,
        user2Id,
        startedAt: new Date()
      };

      // Update sessions
      session1.status = 'matched';
      session1.matchedWith = user2Id;
      session1.lastActivity = new Date();

      session2.status = 'matched';
      session2.matchedWith = user1Id;
      session2.lastActivity = new Date();

      // Store match
      this.activeMatches.set(roomId, match);

      console.log(`Match created: ${match.id} between ${user1Id} and ${user2Id}`);
      return match;
    } catch (error) {
      console.error(`Error creating match between ${user1Id} and ${user2Id}:`, error);
      return null;
    }
  }

  /**
   * End a match and clean up
   */
  endMatch(matchId: string, endReason: 'normal' | 'report' | 'skip' | 'disconnect' = 'normal'): boolean {
    try {
      const match = this.activeMatches.get(matchId);
      if (!match) {
        console.error(`Match ${matchId} not found`);
        return false;
      }

      // Update match record
      match.endedAt = new Date();
      match.endReason = endReason;
      match.duration = match.endedAt.getTime() - match.startedAt.getTime();

      // Update sessions
      const session1 = this.activeSessions.get(match.user1Id);
      const session2 = this.activeSessions.get(match.user2Id);

      if (session1) {
        session1.status = 'waiting';
        session1.matchedWith = undefined;
        session1.lastActivity = new Date();
      }

      if (session2) {
        session2.status = 'waiting';
        session2.matchedWith = undefined;
        session2.lastActivity = new Date();
      }

      // Remove from active matches
      this.activeMatches.delete(matchId);

      console.log(`Match ${matchId} ended with reason: ${endReason}`);
      return true;
    } catch (error) {
      console.error(`Error ending match ${matchId}:`, error);
      return false;
    }
  }

  /**
   * Get current pool size
   */
  getPoolSize(): number {
    return this.matchingPool.size;
  }

  /**
   * Get active matches count
   */
  getActiveMatchesCount(): number {
    return this.activeMatches.size;
  }

  /**
   * Check if user is in matching pool
   */
  isUserInPool(userId: string): boolean {
    return this.matchingPool.has(userId);
  }

  /**
   * Get match by user ID
   */
  getMatchByUserId(userId: string): Match | null {
    for (const match of this.activeMatches.values()) {
      if (match.user1Id === userId || match.user2Id === userId) {
        return match;
      }
    }
    return null;
  }

  /**
   * Clean up inactive sessions (called periodically)
   */
  cleanupInactiveSessions(timeoutMinutes: number = 30): number {
    const now = new Date();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    let cleanedCount = 0;

    // Clean up inactive users from matching pool
    for (const userId of this.matchingPool) {
      const session = this.activeSessions.get(userId);
      if (!session || (now.getTime() - session.lastActivity.getTime()) > timeoutMs) {
        this.matchingPool.delete(userId);
        cleanedCount++;
        console.log(`Cleaned up inactive user ${userId} from matching pool`);
      }
    }

    return cleanedCount;
  }
}