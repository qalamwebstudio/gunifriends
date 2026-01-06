'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from './types';
import Home from './home';
import Image from 'next/image';
import { 
  SOCKET_TIMEOUT_MS
} from './lib/connection-config';

interface User {
  id: string;
  email: string;
  university: string;
  isEmailVerified: boolean;
  lastActiveAt: Date;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'searching' | 'matched' | 'in-call';

export default function Page() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matchingStatus, setMatchingStatus] = useState<'idle' | 'searching' | 'matched'>('idle');
  const [searchStartTime, setSearchStartTime] = useState<Date | null>(null);
  const [searchDuration, setSearchDuration] = useState<number>(0);

  const [sessionRestoreAttempted, setSessionRestoreAttempted] = useState<boolean>(false);

  // Check authentication on component mount
  useEffect(() => {
    // Ensure we're in the browser and localStorage is available
    if (typeof window !== 'undefined' && window.localStorage) {
      checkAuthentication();
    } else {
      setIsLoading(false);
    }
  }, []);

  // Initialize Socket.io connection when user is authenticated
  useEffect(() => {
    if (user && !socket) {
      initializeSocket();
    }

    return () => {
      if (socket) {
        // Send browser closing event before disconnecting (Requirements 8.1)
        socket.emit('browser-closing');
        socket.disconnect();
      }
    };
  }, [user]);

  // Set up browser close detection and heartbeat (Requirements 8.1)
  useEffect(() => {
    if (!socket) return;

    // Send heartbeat every 30 seconds to detect browser close
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat');
      }
    }, 30000); // 30 seconds

    // Handle browser close/refresh events
    const handleBeforeUnload = () => {
      if (socket.connected) {
        socket.emit('browser-closing');
      }
    };

    // Handle page visibility changes (browser tab switching, minimizing)
    const handleVisibilityChange = () => {
      if (socket.connected) {
        socket.emit('heartbeat');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [socket]);

  // Update search duration timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (matchingStatus === 'searching' && searchStartTime) {
      interval = setInterval(() => {
        const now = new Date();
        const duration = Math.floor((now.getTime() - searchStartTime.getTime()) / 1000);
        setSearchDuration(duration);
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [matchingStatus, searchStartTime]);

  const checkAuthentication = async () => {
    try {
      // Check if we're in a browser environment
      if (typeof window === 'undefined') {
        return;
      }

      const token = localStorage.getItem('authToken');
      console.log('Checking authentication, token:', token ? token.substring(0, 20) + '...' : 'null'); // Debug log
      
      if (!token) {
        console.log('No token found, showing home page'); // Debug log
        setIsLoading(false);
        return;
      }

      console.log('Making profile API request...'); // Debug log
      const response = await fetch('/api/auth/profile', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('Profile API response:', response.status, response.ok); // Debug log

      if (!response.ok) {
        console.log('Profile API failed, removing token and showing home page'); // Debug log
        localStorage.removeItem('authToken');
        setIsLoading(false);
        return;
      }

      const data = await response.json();
      console.log('Profile data:', data); // Debug log
      
      if (data.success && data.data && data.data.user) {
        console.log('Authentication successful, setting user'); // Debug log
        setUser(data.data.user);
      } else {
        console.log('Profile data indicates failure, showing home page'); // Debug log
        localStorage.removeItem('authToken');
      }
    } catch (error) {
      console.error('Authentication check failed:', error);
      localStorage.removeItem('authToken');
    } finally {
      setIsLoading(false);
    }
  };

  const initializeSocket = () => {
    const token = localStorage.getItem('authToken');
    if (!token) return;

    // Determine the correct socket URL based on environment
    const getSocketUrl = () => {
      // If we have a dedicated socket server URL, use it
      if (process.env.NEXT_PUBLIC_SOCKET_URL) {
        return process.env.NEXT_PUBLIC_SOCKET_URL;
      }
      
      // If we're running on localhost (development), use localhost
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3001'; // Socket server runs on port 3001
      }
      
      // Fallback (shouldn't reach here in production)
      return window.location.origin;
    };

    const newSocket = io(getSocketUrl(), {
      auth: {
        token
      },
      transports: ['polling', 'websocket'], // Try polling first, then websocket
      timeout: SOCKET_TIMEOUT_MS, // Updated: 30s timeout from centralized config
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setConnectionStatus('connected');
      setError(null);
      
      // Attempt session restoration if not already attempted (Requirements 8.4, 8.5)
      if (!sessionRestoreAttempted) {
        setSessionRestoreAttempted(true);
        newSocket.emit('request-session-restore');
      }
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setConnectionStatus('disconnected');
      setMatchingStatus('idle');
      setSearchStartTime(null);
      setSearchDuration(0);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setConnectionStatus('disconnected');
      
      // Provide more helpful error messages
      if (!process.env.NEXT_PUBLIC_SOCKET_URL && window.location.hostname !== 'localhost') {
        setError('Socket server URL not configured. Please set NEXT_PUBLIC_SOCKET_URL environment variable.');
      } else {
        setError('Failed to connect to socket server. Please try again.');
      }
    });

    newSocket.on('match-found', (matchData) => {
      console.log('🎯 MATCH FOUND: partnerId=' + matchData.partnerId + ', roomId=' + matchData.roomId);
      setMatchingStatus('matched');
      setConnectionStatus('matched');
      setSearchStartTime(null);
      setSearchDuration(0);
      
      // Navigate to video chat interface
      const chatUrl = `/chat?partnerId=${matchData.partnerId}&roomId=${matchData.roomId}`;
      console.log('🚀 MATCHING: Navigating to chat page');
      router.push(chatUrl);
    });

    newSocket.on('error', (errorMessage) => {
      console.error('Server error:', errorMessage);
      setError(errorMessage);
      setMatchingStatus('idle');
      setSearchStartTime(null);
      setSearchDuration(0);
    });

    // Handle session timeout from server (Requirements 8.3)
    newSocket.on('session-timeout', () => {
      console.log('Session timed out due to inactivity');
      setError('Your session has timed out due to inactivity. Please refresh the page.');
      setConnectionStatus('disconnected');
      setMatchingStatus('idle');
      // Automatically redirect to login after a delay
      setTimeout(() => {
        localStorage.removeItem('authToken');
        router.push('/login');
      }, 3000);
    });

    // Handle partner timeout (Requirements 8.2)
    newSocket.on('partner-timeout', () => {
      console.log('Partner session timed out');
      setError('Your chat partner\'s session timed out. Returning to home page.');
      setConnectionStatus('connected');
      setMatchingStatus('idle');
    });

    // Handle session restoration (Requirements 8.4, 8.5)
    newSocket.on('session-restored', (data) => {
      console.log('Session restored:', data);
      if (data.wasReconnected) {
        // Redirect to chat page with restored session
        const chatUrl = `/chat?partnerId=${data.partnerId}&roomId=${data.roomId}&restored=true`;
        router.push(chatUrl);
      }
    });

    newSocket.on('session-restore-failed', (data) => {
      console.log('Session restoration failed:', data.reason);
      // Continue with normal flow
    });

    // Handle partner temporary disconnection (Requirements 8.5)
    newSocket.on('partner-temporarily-disconnected', (data) => {
      console.log('Partner temporarily disconnected:', data);
      setError(`Your chat partner temporarily disconnected (${data.reason}). Waiting for reconnection...`);
    });

    // Handle partner reconnection (Requirements 8.5)
    newSocket.on('partner-reconnected', (data) => {
      console.log('Partner reconnected:', data);
      setError(null);
    });

    setSocket(newSocket);
  };

  const handleStartMatching = () => {
    if (!socket || connectionStatus !== 'connected') {
      setError('Not connected to server. Please refresh the page.');
      return;
    }

    console.log('🟢 MATCHING: User entered queue');
    setMatchingStatus('searching');
    setConnectionStatus('searching');
    setSearchStartTime(new Date());
    setSearchDuration(0);
    setError(null);
    console.log('📤 MATCHING: Sending join-matching-pool request');
    socket.emit('join-matching-pool');
  };

  const handleStopMatching = () => {
    if (!socket) return;

    setMatchingStatus('idle');
    setConnectionStatus('connected');
    setSearchStartTime(null);
    setSearchDuration(0);
    socket.emit('leave-matching-pool');
  };

  const handleLogout = () => {
    if (socket) {
      socket.disconnect();
    }
    localStorage.removeItem('authToken');
    router.push('/login');
  };

  const formatSearchDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getQueueStatusMessage = (): string => {
    switch (matchingStatus) {
      case 'idle':
        return connectionStatus === 'connected' ? 'Ready to find a student' : 'Connecting to server...';
      case 'searching':
        return `Searching for student... (${formatSearchDuration(searchDuration)})`;
      case 'matched':
        return 'Match found! Preparing video chat...';
      default:
        return 'Unknown status';
    }
  };

  const getQueueStatusColor = (): string => {
    switch (matchingStatus) {
      case 'idle':
        return connectionStatus === 'connected' ? 'text-green-600' : 'text-yellow-600';
      case 'searching':
        return 'text-blue-600';
      case 'matched':
        return 'text-green-600';
      default:
        return 'text-gray-600';
    }
  };

  const isMatchingButtonDisabled = (): boolean => {
    return connectionStatus !== 'connected' || matchingStatus === 'matched';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If user is not authenticated, show the home page
  if (!user) {
    return <Home />;
  }

  // If user is authenticated, show the matching dashboard
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <Image 
              src="/logohero.png" 
              alt="Logo" 
              width={120}
              height={40}
              className="h-10 w-auto"
            />
            <div>
              <p className="text-sm text-gray-600">Welcome, {user.email}</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${
                connectionStatus === 'connected' ? 'bg-green-500' : 
                connectionStatus === 'connecting' || connectionStatus === 'searching' ? 'bg-yellow-500' : 
                'bg-red-500'
              }`}></div>
              <span className="text-sm text-gray-600 capitalize">{connectionStatus}</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center">
          <div className="bg-white rounded-lg shadow-md p-8 max-w-md mx-auto">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Connect with Fellow Students
            </h2>
            <p className="text-gray-600 mb-6">
              Start a video chat with a randomly matched student from your university network.
            </p>

            {/* Error Display */}
            {error && (
              <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                {error}
              </div>
            )}

            {/* Queue Status Display */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
              <div className="flex items-center justify-center space-x-2 mb-2">
                <div className={`w-3 h-3 rounded-full ${
                  connectionStatus === 'connected' && matchingStatus === 'idle' ? 'bg-green-500' : 
                  connectionStatus === 'searching' || matchingStatus === 'searching' ? 'bg-blue-500 animate-pulse' : 
                  connectionStatus === 'matched' || matchingStatus === 'matched' ? 'bg-green-500' :
                  'bg-red-500'
                }`}></div>
                <span className={`text-sm font-medium ${getQueueStatusColor()}`}>
                  {getQueueStatusMessage()}
                </span>
              </div>
              
              {/* Additional queue information */}
              {matchingStatus === 'searching' && (
                <div className="text-xs text-gray-500 mt-2">
                  <p>Looking for available students...</p>
                  <p>This usually takes less than a minute</p>
                </div>
              )}
              
              {matchingStatus === 'matched' && (
                <div className="text-xs text-green-600 mt-2">
                  <p>✓ Student found! Setting up video connection...</p>
                </div>
              )}
              
              {connectionStatus === 'disconnected' && (
                <div className="text-xs text-red-600 mt-2">
                  <p>Connection lost. Please refresh the page.</p>
                </div>
              )}
            </div>

            {/* Matching Button */}
            <div className="space-y-4">
              {matchingStatus === 'idle' && (
                <button
                  onClick={handleStartMatching}
                  disabled={isMatchingButtonDisabled()}
                  className={`w-full py-3 px-6 rounded-lg font-medium transition-colors ${
                    !isMatchingButtonDisabled()
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {connectionStatus === 'connected' ? 'Start Matching' : 'Connecting...'}
                </button>
              )}

              {matchingStatus === 'searching' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-center space-x-3 p-4 bg-blue-50 rounded-lg">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    <div className="text-center">
                      <p className="text-blue-700 font-medium">Searching for student...</p>
                      <p className="text-blue-600 text-sm">{formatSearchDuration(searchDuration)}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleStopMatching}
                    className="w-full py-3 px-6 rounded-lg font-medium bg-gray-600 hover:bg-gray-700 text-white transition-colors"
                  >
                    Cancel Search
                  </button>
                </div>
              )}

              {matchingStatus === 'matched' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-center space-x-3 p-4 bg-green-50 rounded-lg">
                    <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <p className="text-green-700 font-medium">Match found!</p>
                      <p className="text-green-600 text-sm">Preparing video chat...</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* University Info */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-xs text-gray-500">
                Connected as: {user.university}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Only verified university students can join
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}