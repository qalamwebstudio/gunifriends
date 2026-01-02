import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../lib/database';
import { ApiResponse } from '../../types';

export async function GET(request: NextRequest) {
  try {
    // Test database connection
    const isConnected = await db.ping();
    
    if (isConnected) {
      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          status: 'healthy',
          database: 'connected',
          timestamp: new Date().toISOString()
        },
        message: 'Application is healthy and database is connected'
      }, { status: 200 });
    } else {
      return NextResponse.json<ApiResponse>({
        success: false,
        data: {
          status: 'unhealthy',
          database: 'disconnected',
          timestamp: new Date().toISOString()
        },
        error: 'Database connection failed'
      }, { status: 503 });
    }
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json<ApiResponse>({
      success: false,
      data: {
        status: 'unhealthy',
        database: 'error',
        timestamp: new Date().toISOString()
      },
      error: 'Health check failed'
    }, { status: 500 });
  }
}