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

    if (!user.emailVerificationToken) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'No verification token found for this user'
      }, { status: 400 });
    }

    const verificationUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/auth/verify?token=${user.emailVerificationToken}`;

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        email: user.email,
        university: user.university,
        verificationUrl,
        isEmailVerified: user.isEmailVerified
      },
      message: 'Verification link retrieved successfully'
    }, { status: 200 });

  } catch (error) {
    console.error('Get verification link error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error while retrieving verification link'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json<ApiResponse>({
    success: false,
    error: 'Use POST method with email address to get verification link'
  }, { status: 405 });
}