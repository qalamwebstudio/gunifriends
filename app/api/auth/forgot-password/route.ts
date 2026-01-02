import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/database';
import { ValidationUtils, SecurityUtils } from '../../../lib/auth';
import { sendEmail } from '../../../lib/email';
import { ApiResponse } from '../../../types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    // Validate required fields
    const { isValid: hasRequiredFields, missingFields } = ValidationUtils.validateRequiredFields(
      { email },
      ['email']
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

    // Check rate limiting for password reset requests
    const rateLimitResult = SecurityUtils.checkRateLimit(`reset_${normalizedEmail}`);
    if (!rateLimitResult.isAllowed) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Too many password reset requests. Please try again later.'
      }, { status: 429 });
    }

    // Find user by email
    const user = await db.getUserByEmail(normalizedEmail);

    // Always return success to prevent email enumeration
    // But only send email if user exists
    if (user && user.isActive && user.isEmailVerified) {
      // Generate password reset token
      const { token, expiresAt } = SecurityUtils.generatePasswordResetToken();

      // Update user with reset token
      await db.updateUser(user.id, {
        passwordResetToken: token,
        passwordResetExpiresAt: expiresAt
      });

      // Send password reset email
      const resetUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
      
      try {
        await sendEmail({
          to: user.email,
          subject: 'Password Reset Request - University Video Chat',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Password Reset Request</h2>
              <p>Hello,</p>
              <p>You have requested to reset your password for your University Video Chat account.</p>
              <p>Click the link below to reset your password:</p>
              <p>
                <a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                  Reset Password
                </a>
              </p>
              <p>This link will expire in 1 hour.</p>
              <p>If you did not request this password reset, please ignore this email.</p>
              <p>Best regards,<br>University Video Chat Team</p>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
        // Don't expose email sending errors to the user
      }
    } else {
      // Record failed attempt for non-existent or inactive users
      SecurityUtils.recordFailedAttempt(`reset_${normalizedEmail}`);
    }

    // Always return success message to prevent email enumeration
    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.'
    }, { status: 200 });

  } catch (error) {
    console.error('Password reset request error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error during password reset request'
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