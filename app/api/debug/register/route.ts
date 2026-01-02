import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/database';
import { PasswordUtils, TokenUtils, ValidationUtils } from '../../../lib/auth';
import { UniversityEmailValidator } from '../../../utils/validation';
import { sendVerificationEmail } from '../../../lib/email';
import { ApiResponse } from '../../../types';

export async function POST(request: NextRequest) {
  const debugInfo: any = {
    step: 'starting',
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
      hasMongoUri: !!process.env.MONGODB_URI,
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasSmtpConfig: !!(process.env.SMTP_USER && process.env.SMTP_PASS)
    }
  };

  try {
    debugInfo.step = 'parsing_body';
    const body = await request.json();
    const { email, password, university } = body;
    
    debugInfo.requestData = {
      hasEmail: !!email,
      hasPassword: !!password,
      hasUniversity: !!university,
      emailLength: email?.length || 0
    };

    debugInfo.step = 'validating_required_fields';
    // Validate required fields
    const { isValid: hasRequiredFields, missingFields } = ValidationUtils.validateRequiredFields(
      { email, password, university },
      ['email', 'password', 'university']
    );

    if (!hasRequiredFields) {
      debugInfo.error = `Missing required fields: ${missingFields.join(', ')}`;
      return NextResponse.json<ApiResponse>({
        success: false,
        error: debugInfo.error,
        data: { debug: debugInfo }
      }, { status: 400 });
    }

    debugInfo.step = 'validating_email';
    // Validate email format and university domain
    const emailValidation = UniversityEmailValidator.validateUniversityEmail(email);
    debugInfo.emailValidation = emailValidation;
    
    if (!emailValidation.isValid) {
      debugInfo.error = emailValidation.errors.join(', ');
      return NextResponse.json<ApiResponse>({
        success: false,
        error: debugInfo.error,
        data: { debug: debugInfo }
      }, { status: 400 });
    }

    debugInfo.step = 'validating_password';
    // Validate password strength
    const passwordValidation = PasswordUtils.validatePasswordStrength(password);
    debugInfo.passwordValidation = {
      isValid: passwordValidation.isValid,
      errorCount: passwordValidation.errors.length
    };
    
    if (!passwordValidation.isValid) {
      debugInfo.error = passwordValidation.errors.join(', ');
      return NextResponse.json<ApiResponse>({
        success: false,
        error: debugInfo.error,
        data: { debug: debugInfo }
      }, { status: 400 });
    }

    debugInfo.step = 'connecting_to_database';
    // Test database connection
    const isDbConnected = await db.ping();
    debugInfo.databaseConnection = isDbConnected;
    
    if (!isDbConnected) {
      debugInfo.error = 'Database connection failed';
      return NextResponse.json<ApiResponse>({
        success: false,
        error: debugInfo.error,
        data: { debug: debugInfo }
      }, { status: 503 });
    }

    debugInfo.step = 'checking_existing_user';
    // Check if user already exists
    const normalizedEmail = ValidationUtils.sanitizeString(email);
    const existingUser = await db.getUserByEmail(normalizedEmail);
    debugInfo.existingUser = !!existingUser;
    
    if (existingUser) {
      debugInfo.error = 'An account with this email already exists';
      return NextResponse.json<ApiResponse>({
        success: false,
        error: debugInfo.error,
        data: { debug: debugInfo }
      }, { status: 409 });
    }

    debugInfo.step = 'hashing_password';
    // Hash password
    const passwordHash = await PasswordUtils.hashPassword(password);
    debugInfo.passwordHashed = !!passwordHash;

    debugInfo.step = 'generating_verification_token';
    // Generate email verification token
    const emailVerificationToken = TokenUtils.generateVerificationToken();
    debugInfo.verificationTokenGenerated = !!emailVerificationToken;

    debugInfo.step = 'creating_user';
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
    debugInfo.userCreated = !!newUser;

    debugInfo.step = 'sending_verification_email';
    // Send verification email
    let emailSent = false;
    try {
      emailSent = await sendVerificationEmail(newUser.email, emailVerificationToken);
      debugInfo.emailSent = emailSent;
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      debugInfo.emailError = emailError instanceof Error ? emailError.message : 'Unknown email error';
      // Don't fail registration if email sending fails
    }

    debugInfo.step = 'success';
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
      data: { 
        user: userResponse,
        debug: debugInfo
      },
      message: 'Registration successful. Please check your email for verification instructions.'
    }, { status: 201 });

  } catch (error) {
    debugInfo.step = 'error';
    debugInfo.error = error instanceof Error ? error.message : 'Unknown error';
    debugInfo.errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error('Registration error:', error);
    console.error('Debug info:', debugInfo);
    
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error during registration',
      data: { debug: debugInfo }
    }, { status: 500 });
  }
}