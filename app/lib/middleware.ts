import { NextRequest } from 'next/server';
import { TokenUtils, SessionUtils } from './auth';
import { db } from './database';
import { User } from '../types';

export interface AuthenticatedRequest extends NextRequest {
  user?: Omit<User, 'passwordHash'>;
}

/**
 * Middleware to authenticate requests using JWT tokens
 */
export async function authenticateRequest(request: NextRequest): Promise<{
  isAuthenticated: boolean;
  user?: Omit<User, 'passwordHash'>;
  error?: string;
}> {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.get('authorization');
    const token = SessionUtils.extractTokenFromHeader(authHeader);

    if (!token) {
      return {
        isAuthenticated: false,
        error: 'No authentication token provided'
      };
    }

    // Verify and decode token
    const decoded = TokenUtils.verifyToken(token);
    if (!decoded) {
      return {
        isAuthenticated: false,
        error: 'Invalid or expired token'
      };
    }

    // Get user from database
    const user = await db.getUserById(decoded.userId);
    if (!user) {
      return {
        isAuthenticated: false,
        error: 'User not found'
      };
    }

    // Check if user is active
    if (!user.isActive) {
      return {
        isAuthenticated: false,
        error: 'Account has been deactivated'
      };
    }

    // Check if email is verified (for endpoints that require it)
    if (!user.isEmailVerified) {
      return {
        isAuthenticated: false,
        error: 'Email verification required'
      };
    }

    // Return user data without password hash
    const { passwordHash, ...userWithoutPassword } = user;

    return {
      isAuthenticated: true,
      user: userWithoutPassword
    };

  } catch (error) {
    console.error('Authentication error:', error);
    return {
      isAuthenticated: false,
      error: 'Authentication failed'
    };
  }
}

/**
 * Middleware to authenticate requests and allow unverified users
 */
export async function authenticateRequestAllowUnverified(request: NextRequest): Promise<{
  isAuthenticated: boolean;
  user?: Omit<User, 'passwordHash'>;
  error?: string;
}> {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.get('authorization');
    const token = SessionUtils.extractTokenFromHeader(authHeader);

    if (!token) {
      return {
        isAuthenticated: false,
        error: 'No authentication token provided'
      };
    }

    // Verify and decode token
    const decoded = TokenUtils.verifyToken(token);
    if (!decoded) {
      return {
        isAuthenticated: false,
        error: 'Invalid or expired token'
      };
    }

    // Get user from database
    const user = await db.getUserById(decoded.userId);
    if (!user) {
      return {
        isAuthenticated: false,
        error: 'User not found'
      };
    }

    // Check if user is active
    if (!user.isActive) {
      return {
        isAuthenticated: false,
        error: 'Account has been deactivated'
      };
    }

    // Return user data without password hash (allow unverified users)
    const { passwordHash, ...userWithoutPassword } = user;

    return {
      isAuthenticated: true,
      user: userWithoutPassword
    };

  } catch (error) {
    console.error('Authentication error:', error);
    return {
      isAuthenticated: false,
      error: 'Authentication failed'
    };
  }
}

/**
 * Helper function to create authentication response
 */
export function createAuthErrorResponse(error: string, status: number = 401) {
  return Response.json({
    success: false,
    error
  }, { status });
}