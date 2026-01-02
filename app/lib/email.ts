import nodemailer from 'nodemailer';

// Email configuration - in production, use environment variables
const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports like 587
  auth: {
    user: process.env.SMTP_USER || 'your-email@gmail.com',
    pass: process.env.SMTP_PASS || 'your-app-password',
  },
};

const transporter = nodemailer.createTransport(EMAIL_CONFIG);

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    // Check if we should send emails or just log them
    const shouldSendEmails = process.env.SEND_EMAILS === 'true' || process.env.NODE_ENV === 'production';
    
    if (!shouldSendEmails) {
      console.log('📧 Email would be sent (SEND_EMAILS=false):', {
        to: options.to,
        subject: options.subject,
        html: options.html,
      });
      return true;
    }

    // Validate email configuration
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('❌ Email configuration missing: SMTP_USER or SMTP_PASS not set');
      console.log('📧 Email would be sent (missing config):', {
        to: options.to,
        subject: options.subject,
      });
      return false;
    }

    console.log('📧 Attempting to send email...');
    console.log('📧 SMTP Config:', {
      host: EMAIL_CONFIG.host,
      port: EMAIL_CONFIG.port,
      secure: EMAIL_CONFIG.secure,
      user: EMAIL_CONFIG.auth.user,
      passLength: EMAIL_CONFIG.auth.pass?.length || 0
    });
    console.log('📧 Email details:', {
      to: options.to,
      subject: options.subject,
    });
    
    const info = await transporter.sendMail({
      from: `"University Video Chat" <${EMAIL_CONFIG.auth.user}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    console.log('✅ Email sent successfully:', info.messageId);
    console.log('✅ Email response:', info.response);
    return true;
  } catch (error) {
    console.error('❌ Error sending email:', error);
    
    // More detailed error logging
    if (error instanceof Error) {
      console.error('❌ Error name:', error.name);
      console.error('❌ Error message:', error.message);
      console.error('❌ Error stack:', error.stack);
    }
    
    // Fallback: log the email content so user can manually verify
    console.log('📧 Email content (fallback):', {
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    
    return false;
  }
}

export function generateVerificationEmailHtml(verificationToken: string): string {
  const verificationUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/auth/verify?token=${verificationToken}`;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Verify Your University Email</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4f46e5; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .button { display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>University Video Chat</h1>
        </div>
        <div class="content">
          <h2>Verify Your University Email</h2>
          <p>Thank you for registering with University Video Chat! To complete your registration, please verify your university email address by clicking the button below:</p>
          <a href="${verificationUrl}" class="button">Verify Email Address</a>
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p><a href="${verificationUrl}">${verificationUrl}</a></p>
          <p>This verification link will expire in 24 hours.</p>
          <p>If you didn't create an account with us, please ignore this email.</p>
        </div>
        <div class="footer">
          <p>University Video Chat - Connecting Students Safely</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function sendVerificationEmail(email: string, verificationToken: string): Promise<boolean> {
  const html = generateVerificationEmailHtml(verificationToken);
  
  return sendEmail({
    to: email,
    subject: 'Verify Your University Email - University Video Chat',
    html,
    text: `Please verify your email by visiting: ${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/auth/verify?token=${verificationToken}`,
  });
}