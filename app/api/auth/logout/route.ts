import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '../../../types';

export async function POST(request: NextRequest) {
  try {
    // For JWT-based authentication, logout is handled client-side by removing the token
    // Server-side logout would require token blacklisting, which we're not implementing
    // in this simple version
    
    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Logout successful'
    }, { status: 200 });

  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      error: 'Internal server error during logout'
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