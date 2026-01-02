import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '../../lib/email';
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

    // Send test email
    const emailSent = await sendEmail({
      to: email,
      subject: 'Test Email - University Video Chat',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4f46e5;">Email Configuration Test</h2>
          <p>This is a test email to verify that the email system is working correctly.</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p>If you received this email, the email configuration is working properly!</p>
          <hr style="margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">University Video Chat - Email System Test</p>
        </div>
      `,
      text: `Email Configuration Test - This is a test email sent at ${new Date().toISOString()}`
    });

    if (emailSent) {
      return NextResponse.json<ApiResponse>({
        success: true,
        message: `Test email sent successfully to ${email}`
      }, { status: 200 });
    } else {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Failed to send test email. Check server logs for details.'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Test email error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error while sending test email'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json<ApiResponse>({
    success: false,
    error: 'Use POST method to send test email'
  }, { status: 405 });
}