import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/database';
import { ApiResponse } from '../../../types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Verification token is required'
      }, { status: 400 });
    }

    // Find user by verification token using the new MongoDB method
    const user = await db.getUserByVerificationToken(token);

    if (!user) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid or expired verification token'
      }, { status: 400 });
    }

    if (user.isEmailVerified) {
      return NextResponse.json<ApiResponse>({
        success: true,
        message: 'Email is already verified'
      }, { status: 200 });
    }

    // Update user to mark email as verified
    const updatedUser = await db.updateUser(user.id, {
      isEmailVerified: true,
      emailVerificationToken: undefined, // Clear the token
      lastActiveAt: new Date()
    });

    if (!updatedUser) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Failed to verify email'
      }, { status: 500 });
    }

    // Return success response with redirect
    return NextResponse.redirect(
      new URL('/login?verified=true', request.url),
      { status: 302 }
    );

  } catch (error) {
    console.error('Email verification error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error during email verification'
    }, { status: 500 });
  }
}

// Handle unsupported methods
export async function POST() {
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