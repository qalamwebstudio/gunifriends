import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { db } from '../../lib/database';
import { Report, ApiResponse } from '../../types';
import { ValidationUtils } from '../../lib/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const REPORT_THRESHOLD = 3; // Number of reports before auto-flagging

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Authentication required'
      }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decoded: any;
    
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid token'
      }, { status: 401 });
    }

    const reporterId = decoded.userId;

    // Parse request body
    const body = await request.json();
    const { reportedUserId, category, description, sessionId } = body;

    // Validate required fields
    const { isValid: hasRequiredFields, missingFields } = ValidationUtils.validateRequiredFields(
      { reportedUserId, category },
      ['reportedUserId', 'category']
    );

    if (!hasRequiredFields) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`
      }, { status: 400 });
    }

    // Validate category
    const validCategories = ['inappropriate-behavior', 'harassment', 'spam', 'other'];
    if (!validCategories.includes(category)) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid report category. Must be one of: inappropriate-behavior, harassment, spam, other'
      }, { status: 400 });
    }

    // Prevent self-reporting
    if (reporterId === reportedUserId) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Cannot report yourself'
      }, { status: 400 });
    }

    // Verify reported user exists
    const reportedUser = await db.getUserById(reportedUserId);
    if (!reportedUser) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Reported user not found'
      }, { status: 404 });
    }

    // Create report in database
    const report = await db.createReport({
      reporterId,
      reportedUserId,
      category,
      description: ValidationUtils.sanitizeString(description || ''),
      status: 'pending',
      sessionId: sessionId || undefined
    });

    console.log(`Report submitted: ${report.id} - ${reporterId} reported ${reportedUserId} for ${category}`);

    // Get current report count for the reported user
    const userReports = await db.getReportsByUserId(reportedUserId);
    const reportCount = userReports.length;

    // Check if user should be automatically flagged
    let autoFlagged = false;
    if (reportCount >= REPORT_THRESHOLD) {
      autoFlagged = true;
      
      // Update user's report count and flag status
      await db.updateUser(reportedUserId, {
        reportCount: reportCount,
        isActive: false // Deactivate user when flagged
      });

      console.log(`User ${reportedUserId} has been automatically flagged (${reportCount} reports)`);
    } else {
      // Update user's report count
      await db.updateUser(reportedUserId, {
        reportCount: reportCount
      });
    }

    // Return success response
    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        reportId: report.id,
        message: 'Report submitted successfully',
        autoFlagged,
        reportCount
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Error processing report:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error during report processing'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Authentication required'
      }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decoded: any;
    
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return NextResponse.json<ApiResponse>({
        success: false,
        error: 'Invalid token'
      }, { status: 401 });
    }

    // Get query parameters for filtering
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (userId) {
      // Return reports for a specific user (for moderation purposes)
      const userReports = await db.getReportsByUserId(userId);
      
      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          reports: userReports,
          totalCount: userReports.length
        }
      });
    } else {
      // Return general statistics (for admin dashboard)
      // Note: In production, this should have proper admin authorization
      const allUsers = await db.getAllUsers();
      const flaggedUsers = allUsers.filter(user => user.reportCount >= REPORT_THRESHOLD);
      
      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          flaggedUsersCount: flaggedUsers.length,
          flaggedUsers: flaggedUsers.map(user => ({
            id: user.id,
            email: user.email,
            reportCount: user.reportCount,
            isActive: user.isActive
          }))
        }
      });
    }

  } catch (error) {
    console.error('Error fetching report data:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error during report retrieval'
    }, { status: 500 });
  }
}

// Handle unsupported methods
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