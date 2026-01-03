'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '../types';
import VideoChat from '../components/VideoChat';

interface User {
  id: string;
  email: string;
  university: string;
  isEmailVerified: boolean;
  lastActiveAt: Date;
}

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Chat session data from URL params or socket events
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isSessionRestored, setIsSessionRestored] = useState<boolean>(false);
  const [sessionRestoreAttempted, setSessionRestoreAttempted] = useState<boolean>(false);

  useEffect(() => {
    // Get match data from URL parameters (passed from home page)
    const partnerIdParam = searchParams.get('partnerId');
    const roomIdParam = searchParams.get('roomId');
    const restoredParam = searchParams.get('restored');
    
    if (partnerIdParam && roomIdParam) {
      setPartnerId(partnerIdParam);
      setRoomId(roomIdParam);
      setIsSessionRestored(restoredParam === 'true');
    }

    checkAuthentication();
  }, [searchParams]);

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
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
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

  const checkAuthentication = async () => {
    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/auth/profile', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        localStorage.removeItem('authToken');
        router.push('/login');
        return;
      }

      const data = await response.json();
      if (data.success) {
        setUser(data.data.user);
      } else {
        localStorage.removeItem('authToken');
        router.push('/login');
      }
    } catch (error) {
      console.error('Authentication check failed:', error);
      localStorage.removeItem('authToken');
      router.push('/login');
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
      timeout: 20000,
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log('Connected to server for video chat');
      setError(null);
      
      // Only attempt session restoration if we don't already have match data from URL
      if (!partnerId && !roomId && !sessionRestoreAttempted) {
        setSessionRestoreAttempted(true);
        console.log('Attempting session restoration...');
        newSocket.emit('request-session-restore');
      } else if (partnerId && roomId) {
        console.log('Using match data from URL parameters');
      }
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      handleCallEnd();
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      
      // Provide more helpful error messages
      if (!process.env.NEXT_PUBLIC_SOCKET_URL && window.location.hostname !== 'localhost') {
        setError('Socket server URL not configured. Please set NEXT_PUBLIC_SOCKET_URL environment variable.');
      } else {
        setError('Failed to connect to socket server. Please try again.');
      }
    });

    newSocket.on('match-found', (matchData) => {
      console.log('New match found in chat page:', matchData);
      setPartnerId(matchData.partnerId);
      setRoomId(matchData.roomId);
    });

    newSocket.on('error', (errorMessage) => {
      console.error('Server error:', errorMessage);
      
      // Don't immediately redirect on certain errors - try to recover
      if (errorMessage.includes('Partner session not found') || 
          errorMessage.includes('No active partner session') ||
          errorMessage.includes('Partner not connected')) {
        console.log('Partner session error - attempting to recover...');
        setError(`Connection issue: ${errorMessage}. Retrying...`);
        
        // Try to rejoin matching pool after a delay
        setTimeout(() => {
          if (newSocket.connected) {
            console.log('Attempting to rejoin matching pool...');
            newSocket.emit('leave-matching-pool');
            setTimeout(() => {
              newSocket.emit('join-matching-pool');
            }, 1000);
          }
        }, 2000);
      } else {
        setError(errorMessage);
      }
    });

    // Handle session timeout from server (Requirements 8.3)
    newSocket.on('session-timeout', () => {
      console.log('Session timed out due to inactivity');
      setError('Your session has timed out due to inactivity. Returning to login.');
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
      setTimeout(() => {
        handleCallEnd();
      }, 2000);
    });

    // Handle session restoration (Requirements 8.4, 8.5)
    newSocket.on('session-restored', (data) => {
      console.log('Session restored in chat page:', data);
      if (data.wasReconnected && !partnerId && !roomId) {
        // Only use restored session if we don't have current match data
        setPartnerId(data.partnerId);
        setRoomId(data.roomId);
        setIsSessionRestored(true);
        setError('Session restored successfully. Reconnecting to video chat...');
        setTimeout(() => setError(null), 3000);
      } else {
        console.log('Ignoring session restoration - already have match data');
      }
    });

    newSocket.on('session-restore-failed', (data) => {
      console.log('Session restoration failed in chat page:', data.reason);
      // Don't show error or redirect if we already have match data
      if (!partnerId && !roomId) {
        setError('Unable to restore previous session. Please try matching again.');
        setTimeout(() => {
          handleCallEnd();
        }, 2000);
      }
    });

    // Handle partner temporary disconnection (Requirements 8.5)
    newSocket.on('partner-temporarily-disconnected', (data) => {
      console.log('Partner temporarily disconnected:', data);
      setError(`Your chat partner temporarily disconnected (${data.reason}). Waiting for reconnection...`);
    });

    // Handle partner reconnection (Requirements 8.5)
    newSocket.on('partner-reconnected', (data) => {
      console.log('Partner reconnected:', data);
      setError('Your chat partner has reconnected!');
      setTimeout(() => setError(null), 3000);
    });

    setSocket(newSocket);
  };

  const handleCallEnd = () => {
    console.log('Call ended, returning to home page');
    router.push('/');
  };

  const handleError = (errorMessage: string) => {
    console.error('Video chat error:', errorMessage);
    setError(errorMessage);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4">Loading video chat...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect to login
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white max-w-md mx-auto p-6">
          <div className="bg-red-600 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2">Connection Error</h2>
          <p className="text-gray-300 mb-6">{error}</p>
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={handleCallEnd}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded transition-colors"
            >
              Return to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!socket || !partnerId || !roomId) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white max-w-md mx-auto p-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold mb-2">Setting up video chat...</h2>
          <p className="text-gray-300 mb-6">
            {!socket ? 'Connecting to server...' : 'Waiting for match information...'}
          </p>
          <button
            onClick={handleCallEnd}
            className="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <VideoChat
      socket={socket}
      partnerId={partnerId}
      roomId={roomId}
      onCallEnd={handleCallEnd}
      onError={handleError}
      isSessionRestored={isSessionRestored}
    />
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4">Loading video chat...</p>
        </div>
      </div>
    }>
      <ChatPageContent />
    </Suspense>
  );
}