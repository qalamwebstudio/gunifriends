import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { User } from '../types';

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_LOGIN_ATTEMPTS = 5;
const ACCOUNT_LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// In-memory store for rate limiting (in production, use Redis)
const loginAttempts = new Map<string, { count: number; firstAttempt: number; lockedUntil?: number }>();

// Periodic cleanup of expired rate limit entries (run every 15 minutes)
setInterval(() => {
  SecurityUtils.cleanupExpiredEntries();
}, 15 * 60 * 1000);

// JWT secret - in production this should be in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

// Password hashing utilities
export class PasswordUtils {
  /**
   * Hash a plain text password
   */
  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Verify a plain text password against a hash
   */
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate password strength
   */
  static validatePasswordStrength(password: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// JWT token utilities
export class TokenUtils {
  /**
   * Generate a JWT token for a user
   */
  static generateToken(user: User): string {
    const payload = {
      userId: user.id,
      email: user.email,
      isEmailVerified: user.isEmailVerified
    };
    
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  /**
   * Verify and decode a JWT token
   */
  static verifyToken(token: string): { userId: string; email: string; isEmailVerified: boolean } | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return {
        userId: decoded.userId,
        email: decoded.email,
        isEmailVerified: decoded.isEmailVerified
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Generate a secure random token for email verification
   */
  static generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}

// Session management utilities
export class SessionUtils {
  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader: string | null): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }

  /**
   * Create session data for authenticated user
   */
  static createSessionData(user: User) {
    return {
      id: user.id,
      email: user.email,
      university: user.university,
      isEmailVerified: user.isEmailVerified,
      lastActiveAt: user.lastActiveAt
    };
  }
}

// Input validation utilities
export class ValidationUtils {
  /**
   * Validate email format
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Sanitize string input
   */
  static sanitizeString(input: string): string {
    return input.trim().toLowerCase();
  }

  /**
   * Validate required fields
   */
  static validateRequiredFields(data: Record<string, any>, requiredFields: string[]): { isValid: boolean; missingFields: string[] } {
    const missingFields = requiredFields.filter(field => !data[field] || data[field].toString().trim() === '');
    
    return {
      isValid: missingFields.length === 0,
      missingFields
    };
  }
}

// Rate limiting and security utilities
export class SecurityUtils {
  /**
   * Check if an IP/email is rate limited
   */
  static checkRateLimit(identifier: string): { isAllowed: boolean; remainingAttempts: number; lockedUntil?: Date } {
    const now = Date.now();
    const attempts = loginAttempts.get(identifier);

    if (!attempts) {
      return { isAllowed: true, remainingAttempts: MAX_LOGIN_ATTEMPTS };
    }

    // Check if account is locked
    if (attempts.lockedUntil && now < attempts.lockedUntil) {
      return { 
        isAllowed: false, 
        remainingAttempts: 0, 
        lockedUntil: new Date(attempts.lockedUntil) 
      };
    }

    // Reset if window has expired
    if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      loginAttempts.delete(identifier);
      return { isAllowed: true, remainingAttempts: MAX_LOGIN_ATTEMPTS };
    }

    // Check if max attempts reached
    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
      const lockedUntil = now + ACCOUNT_LOCKOUT_DURATION_MS;
      loginAttempts.set(identifier, { ...attempts, lockedUntil });
      return { 
        isAllowed: false, 
        remainingAttempts: 0, 
        lockedUntil: new Date(lockedUntil) 
      };
    }

    return { 
      isAllowed: true, 
      remainingAttempts: MAX_LOGIN_ATTEMPTS - attempts.count 
    };
  }

  /**
   * Record a failed login attempt
   */
  static recordFailedAttempt(identifier: string): void {
    const now = Date.now();
    const attempts = loginAttempts.get(identifier);

    if (!attempts || now - attempts.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      loginAttempts.set(identifier, { count: 1, firstAttempt: now });
    } else {
      loginAttempts.set(identifier, { ...attempts, count: attempts.count + 1 });
    }
  }

  /**
   * Clear failed attempts for successful login
   */
  static clearFailedAttempts(identifier: string): void {
    loginAttempts.delete(identifier);
  }

  /**
   * Generate password reset token
   */
  static generatePasswordResetToken(): { token: string; expiresAt: Date } {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    return { token, expiresAt };
  }

  /**
   * Validate password reset token expiry
   */
  static isPasswordResetTokenValid(expiresAt: Date): boolean {
    return new Date() < expiresAt;
  }

  /**
   * Clean up expired rate limit entries
   */
  static cleanupExpiredEntries(): void {
    const now = Date.now();
    for (const [identifier, attempts] of loginAttempts.entries()) {
      if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW_MS && 
          (!attempts.lockedUntil || now > attempts.lockedUntil)) {
        loginAttempts.delete(identifier);
      }
    }
  }
}