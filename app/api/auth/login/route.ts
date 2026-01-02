import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/database';
import { PasswordUtils, TokenUtils, ValidationUtils, SecurityUtils } from '../../../lib/auth';
import { ApiResponse, AuthResponse } from '../../../types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Validate required fields
    const { isValid: hasRequiredFields, missingFields } = ValidationUtils.validateRequiredFields(
      { email, password },
      ['email', 'password']
    );

    if (!hasRequiredFields) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      }, { status: 400 });
    }

    // Validate email format
    if (!ValidationUtils.isValidEmail(email)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid email format'
      }, { status: 400 });
    }

    const normalizedEmail = ValidationUtils.sanitizeString(email);

    // Check rate limiting
    const rateLimitResult = SecurityUtils.checkRateLimit(normalizedEmail);
    if (!rateLimitResult.isAllowed) {
      const lockoutMessage = rateLimitResult.lockedUntil 
        ? `Account temporarily locked until ${rateLimitResult.lockedUntil.toLocaleTimeString()}. Please try again later.`
        : 'Too many login attempts. Please try again later.';
      
      return NextResponse.json<ApiResponse>({
        success: false,
        error: lockoutMessage
      }, { status: 429 });
    }

    // Find user by email
    const user = await db.getUserByEmail(normalizedEmail);

    if (!user) {
      SecurityUtils.recordFailedAttempt(normalizedEmail);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid email or password'
      }, { status: 401 });
    }

    // Check if account is active
    if (!user.isActive) {
      SecurityUtils.recordFailedAttempt(normalizedEmail);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Account has been deactivated. Please contact support.'
      }, { status: 403 });
    }

    // Verify password
    const isPasswordValid = await PasswordUtils.verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      SecurityUtils.recordFailedAttempt(normalizedEmail);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid email or password'
      }, { status: 401 });
    }

    // Check if email is verified
    if (!user.isEmailVerified) {
      SecurityUtils.recordFailedAttempt(normalizedEmail);
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Please verify your email address before logging in. Check your inbox for the verification link.'
      }, { status: 403 });
    }

    // Clear failed attempts on successful login
    SecurityUtils.clearFailedAttempts(normalizedEmail);

    // Update last active timestamp
    await db.updateUser(user.id, {
      lastActiveAt: new Date()
    });

    // Generate JWT token
    const token = TokenUtils.generateToken(user);

    // Prepare user data for response (exclude sensitive information)
    const userResponse = {
      id: user.id,
      email: user.email,
      university: user.university,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
      lastActiveAt: user.lastActiveAt,
      reportCount: user.reportCount,
      isActive: user.isActive
    };

    const authResponse: AuthResponse = {
      user: userResponse,
      token
    };

    return NextResponse.json<ApiResponse<AuthResponse>>({
      success: true,
      data: authResponse,
      message: 'Login successful'
    }, { status: 200 });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error during login'
    }, { status: 500 });
  }
}

// Handle unsupported methods
export async function GET() {
  return NextResponse.json<ApiResponse>({
    success: false,
    error: 'Method not allowed'
  }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json<ApiResponse>({
    success: false,
    error: 'Method not allowed'
  }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json<ApiResponse>({
    success: false,
    error: 'Method not allowed'
  }, { status: 405 });
}