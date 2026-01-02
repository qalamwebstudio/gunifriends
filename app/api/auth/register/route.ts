import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/database';
import { PasswordUtils, TokenUtils, ValidationUtils } from '../../../lib/auth';
import { UniversityEmailValidator } from '../../../utils/validation';
import { sendVerificationEmail } from '../../../lib/email';
import { ApiResponse } from '../../../types';

export async function POST(request: NextRequest) {
  try {
    console.log("😁😁")
    const body = await request.json();
    const { email, password, university } = body;

    // Validate required fields
    const { isValid: hasRequiredFields, missingFields } = ValidationUtils.validateRequiredFields(
      { email, password, university },
      ['email', 'password', 'university']
    );

    if (!hasRequiredFields) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      }, { status: 400 });
    }

    // Validate email format and university domain
    const emailValidation = UniversityEmailValidator.validateUniversityEmail(email);
    if (!emailValidation.isValid) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: emailValidation.errors.join(', ')
      }, { status: 400 });
    }

    // Validate password strength
    const passwordValidation = PasswordUtils.validatePasswordStrength(password);
    if (!passwordValidation.isValid) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: passwordValidation.errors.join(', ')
      }, { status: 400 });
    }

    // Check if user already exists
    const normalizedEmail = ValidationUtils.sanitizeString(email);
    const existingUser = await db.getUserByEmail(normalizedEmail);
    if (existingUser) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'An account with this email already exists'
      }, { status: 409 });
    }

    // Hash password
    const passwordHash = await PasswordUtils.hashPassword(password);

    // Generate email verification token
    const emailVerificationToken = TokenUtils.generateVerificationToken();

    // Create user
    const newUser = await db.createUser({
      email: normalizedEmail,
      passwordHash,
      university: emailValidation.universityName || university,
      isEmailVerified: false,
      emailVerificationToken,
      reportCount: 0,
      isActive: true
    });

    // Send verification email
    try {
      await sendVerificationEmail(newUser.email, emailVerificationToken);
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Don't fail registration if email sending fails
      // User can request resend later
    }

    // Return success response (without sensitive data)
    const userResponse = {
      id: newUser.id,
      email: newUser.email,
      university: newUser.university,
      isEmailVerified: newUser.isEmailVerified,
      createdAt: newUser.createdAt
    };

    return NextResponse.json<ApiResponse>({
      success: true,
      data: { user: userResponse },
      message: 'Registration successful. Please check your email for verification instructions.'
    }, { status: 201 });

  } catch (error) {
    console.error('Registration error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Internal server error during registration';
    
    if (error instanceof Error) {
      // Check for specific MongoDB connection errors
      if (error.message.includes('SSL') || error.message.includes('TLS')) {
        errorMessage = 'Database connection error. Please try again later.';
      } else if (error.message.includes('MONGODB_URI')) {
        errorMessage = 'Database configuration error.';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Database connection timeout. Please try again.';
      } else {
        errorMessage = error.message;
      }
    }
    
    return NextResponse.json<ApiResponse>({
      success: false,
      error: errorMessage
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