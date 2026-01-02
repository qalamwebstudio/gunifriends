import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../lib/database';
import { ApiResponse } from '../../types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Email address is required'
      }, { status: 400 });
    }

    // Find user by email
    const user = await db.getUserByEmail(email.toLowerCase());

    if (!user) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'User not found with this email address'
      }, { status: 404 });
    }

    if (user.isEmailVerified) {
      return NextResponse.json<ApiResponse>({
        success: true,
        message: 'Email is already verified'
      }, { status: 200 });
    }

    // Manually verify the user
    const updatedUser = await db.updateUser(user.id, {
      isEmailVerified: true,
      emailVerificationToken: undefined,
      lastActiveAt: new Date()
    });

    if (!updatedUser) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Failed to verify email'
      }, { status: 500 });
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        email: updatedUser.email,
        university: updatedUser.university,
        isEmailVerified: updatedUser.isEmailVerified
      },
      message: 'Email verified successfully! You can now log in.'
    }, { status: 200 });

  } catch (error) {
    console.error('Manual verification error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error during manual verification'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json<ApiResponse>({
    success: false,
    error: 'Use POST method with email address to manually verify'
  }, { status: 405 });
}