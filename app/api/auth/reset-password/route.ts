import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/database';
import { PasswordUtils, ValidationUtils, SecurityUtils } from '../../../lib/auth';
import { ApiResponse } from '../../../types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = body;

    // Validate required fields
    const { isValid: hasRequiredFields, missingFields } = ValidationUtils.validateRequiredFields(
      { token, password },
      ['token', 'password']
    );

    if (!hasRequiredFields) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      }, { status: 400 });
    }

    // Validate password strength
    const passwordValidation = PasswordUtils.validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: `Password requirements not met: ${passwordValidation.errors.join(', ')}`
      }, { status: 400 });
    }

    // Find user by password reset token
    const user = await db.getUserByPasswordResetToken(token);

    if (!user) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid or expired password reset token'
      }, { status: 400 });
    }

    // Check if account is active
    if (!user.isActive) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Account has been deactivated. Please contact support.'
      }, { status: 403 });
    }

    // Verify token is still valid
    if (!user.passwordResetExpiresAt || !SecurityUtils.isPasswordResetTokenValid(user.passwordResetExpiresAt)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Password reset token has expired. Please request a new one.'
      }, { status: 400 });
    }

    // Hash new password
    const hashedPassword = await PasswordUtils.hashPassword(password);

    // Update user with new password and clear reset token
    await db.updateUser(user.id, {
      passwordHash: hashedPassword,
      passwordResetToken: undefined,
      passwordResetExpiresAt: undefined,
      lastActiveAt: new Date()
    });

    // Clear any failed login attempts for this user
    SecurityUtils.clearFailedAttempts(user.email);

    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.'
    }, { status: 200 });

  } catch (error) {
    console.error('Password reset error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error during password reset'
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