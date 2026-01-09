'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from './types';
import Home from './home';
import Image from 'next/image';
import { gsap } from 'gsap';
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
  const [showProfileMenu, setShowProfileMenu] = useState<boolean>(false);

  const [sessionRestoreAttempted, setSessionRestoreAttempted] = useState<boolean>(false);

  // Animation refs
  const centerCardRef = useRef(null);
  const leftCardRef = useRef(null);
  const rightCardRef = useRef(null);
  const leftLineRef = useRef(null);
  const rightLineRef = useRef(null);
  const bottomCardRef = useRef(null);

  // Check authentication on component mount
  useEffect(() => {
    // Ensure we're in the browser and localStorage is available
    if (typeof window !== 'undefined' && window.localStorage) {
      checkAuthentication();
    } else {
      setIsLoading(false);
    }
  }, []);

  // Close profile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showProfileMenu) {
        setShowProfileMenu(false);
      }
    };

    if (showProfileMenu) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showProfileMenu]);

  // GSAP Animation Effect when user is authenticated
  useEffect(() => {
    if (user && !isLoading) {
      // Set initial states - hide all elements
      gsap.set([leftCardRef.current, rightCardRef.current, bottomCardRef.current], {
        opacity: 0
      });
      gsap.set(centerCardRef.current, { opacity: 0, scale: 0.8 });
      gsap.set(leftCardRef.current, { x: 200, scale: 0.8 }); // Start from center, move left
      gsap.set(rightCardRef.current, { x: -200, scale: 0.8 }); // Start from center, move right
      gsap.set([leftLineRef.current, rightLineRef.current], { opacity: 0, scaleX: 0 });
      gsap.set(bottomCardRef.current, { opacity: 0, y: 30 });

      // Create animation timeline
      const tl = gsap.timeline({ delay: 0.3 });

      // 1. Center card appears first
      tl.to(centerCardRef.current, {
        opacity: 1,
        scale: 1,
        duration: 0.8,
        ease: "back.out(1.7)"
      })

        // 2. Side cards slide out from center to their positions
        .to([leftCardRef.current, rightCardRef.current], {
          opacity: 1,
          x: 0,
          scale: 1,
          duration: 0.6,
          ease: "power2.out"
        }, "-=0.2")

        // 3. Connector lines extend from center
        .to([leftLineRef.current, rightLineRef.current], {
          opacity: 1,
          scaleX: 1,
          duration: 0.4,
          ease: "power2.out"
        }, "-=0.1")

        // 4. Bottom card appears
        .to(bottomCardRef.current, {
          opacity: 1,
          y: 0,
          duration: 0.5,
          ease: "power2.out"
        }, "-=0.2");
    }
  }, [user, isLoading]);

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
        return connectionStatus === 'connected' ? 'Ready to connect with a verified student' : 'Connecting to server...';
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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
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
    <div className="min-h-screen bg-white relative">
      {/* Navigation Bar */}
      <nav className="bg-white border-b border-gray-200 px-4 py-3 ">
        <div className="max-w-7xl mx-auto flex items-center justify-around">
          {/* Logo */}
          <div className="flex items-center space-x-3">
            <Image
              src="/logoherored.png"
              alt="Logo"
              width={120}
              height={40}
            />
          </div>
          <div className="hidden md:block">
            <p className="text-sm  text-gray-700">Welcome, {user.email}</p>
          </div>

          {/* User Profile Menu */}
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              className="w-10 h-10 bg-[#FB2C36] rounded-full flex items-center justify-center hover:bg-[#E02329] transition-colors"
            >
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900 mb-1">Signed in as:</p>
                  <p className="text-sm text-gray-700">{user.email}</p>
                  <p className="text-xs text-gray-500 mt-1">{user.university}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-4 md:py-8">
        <div className="relative">
          {/* Desktop Layout - Container for all cards with connector lines */}
          <div className="hidden md:flex items-end justify-center space-x-8">
            {/* Left Red Card - Our Promise */}
            <div ref={leftCardRef} className="relative self-end">
              <div className="w-72 bg-gradient-to-br from-[#FB2C36] to-[#E02329] rounded-2xl p-6 shadow-xl">
                <div className="text-center text-white">
                  <div className="flex justify-center mb-4">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold mb-6">Our Promise</h3>
                  <div className="space-y-3 text-sm leading-snug">
                    <div className="flex items-start space-x-3">
                      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>We do not record your video</span>
                    </div>
                    <div className="flex items-start space-x-3">
                      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      <span>We never store or sell your data</span>
                    </div>
                    <div className="flex items-start space-x-3">
                      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>Profile shared only in matches</span>
                    </div>
                    <div className="flex items-start space-x-3">
                      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <span>Verified university access only</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* Left Connector Line */}
              <div className="absolute top-1/2 -right-8 transform -translate-y-1/2">
                <div ref={leftLineRef} className="w-8 h-[3px] bg-[#FB2C36] rounded-full origin-left"></div>
              </div>
            </div>

            {/* Center Main Card */}
            <div ref={centerCardRef} className="bg-white rounded-2xl p-8 max-w-lg border border-gray-100 shadow-[0_8px_30px_rgba(213,56,64,0.15)] z-10 self-center">
              <h2 className="text-3xl font-bold text-[#000934] mb-3 text-center">
                Meet Verified Students Instantly
              </h2>
              <p className="text-gray-700 mb-6 text-lg text-center">
                Safe, real-time video chats with students from your university network
              </p>

              {/* Error Display */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-[#D53840] text-[#D53840] rounded-lg">
                  {error}
                </div>
              )}

              {/* Queue Status Display */}
              <div className="mb-6 p-4 bg-white/60 rounded-xl border border-white/40">
                <div className="flex items-center justify-center space-x-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' && matchingStatus === 'idle' ? 'bg-green-500' :
                    connectionStatus === 'searching' || matchingStatus === 'searching' ? 'bg-[#D53840] animate-pulse' :
                      connectionStatus === 'matched' || matchingStatus === 'matched' ? 'bg-green-500' :
                        'bg-red-500'
                    }`}></div>
                  <span className={`text-sm font-medium ${getQueueStatusColor()}`}>
                    {getQueueStatusMessage()}
                  </span>
                </div>

                {/* Additional queue information */}
                {matchingStatus === 'searching' && (
                  <div className="text-xs text-gray-600 mt-2">
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
                  <div className="relative group">
                    {/* Revolving Glowing Border */}
                    <div className="absolute -inset-1 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-[#FB2C36] to-transparent blur-sm"
                        style={{
                          background: 'conic-gradient(from 0deg, transparent, #FB2C36, #E02329, #FB2C36, transparent)',
                          animation: 'spin 2s eas-in  infinite'
                        }}>
                      </div>
                    </div>
                    <button
                      onClick={handleStartMatching}
                      disabled={isMatchingButtonDisabled()}
                      className={`relative w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 ${!isMatchingButtonDisabled()
                        ? 'bg-gradient-to-r from-[#FB2C36] to-[#E02329] hover:from-[#E02329] hover:to-[#D01E24] text-white shadow-lg hover:shadow-2xl hover:shadow-[#FB2C36]/25 transform hover:-translate-y-1 active:translate-y-0 active:shadow-lg'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        }`}
                    >
                      {connectionStatus === 'connected' ? 'Start Matching' : 'Connecting...'}
                    </button>
                  </div>
                )}

                {matchingStatus === 'searching' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-3 p-4 bg-[#D53840]/10 rounded-xl">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#D53840]"></div>
                      <div className="text-center">
                        <p className="text-[#D53840] font-semibold">Searching for student...</p>
                        <p className="text-[#000934] text-sm">{formatSearchDuration(searchDuration)}</p>
                      </div>
                    </div>
                    <button
                      onClick={handleStopMatching}
                      className="w-full py-3 px-6 rounded-xl font-medium bg-[#000934] hover:bg-[#000934]/90 text-white transition-colors"
                    >
                      Cancel Search
                    </button>
                  </div>
                )}

                {matchingStatus === 'matched' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-3 p-4 bg-green-50 rounded-xl">
                      <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="text-green-700 font-semibold">Match found!</p>
                        <p className="text-green-600 text-sm">Preparing video chat...</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Skip/End Info */}
              <p className="text-sm text-gray-600 mt-4 text-center">You can skip or end anytime</p>
            </div>

            {/* Right Red Card - Your Responsibility */}
            <div ref={rightCardRef} className="relative self-end">
              <div className="w-72 bg-gradient-to-bl from-[#FB2C36] to-[#E02329] rounded-2xl p-6 shadow-xl">
                <div className="text-center text-white">
                  <div className="flex justify-center mb-4">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold mb-6">Your Responsibility</h3>
                  <div className="space-y-3 text-sm leading-snug">
                    <div className="flex items-start space-x-3">
                      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                      <span>Be respectful to fellow students</span>
                    </div>
                    <div className="flex items-start space-x-3">
                      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>Keep your camera visible</span>
                    </div>
                    <div className="flex items-start space-x-3">
                      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L12 21l-6.364-6.364M12 21l6.364-6.364M12 21V9m0 12l-6.364-6.364M12 21l6.364-6.364" />
                      </svg>
                      <span>No harassment or misuse</span>
                    </div>
                    <div className="flex items-start space-x-3">
                      <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Be friendly and professional</span>
                    </div>
                  </div>
                </div>
              </div>
              {/* Right Connector Line */}
              <div className="absolute top-1/2 -left-8 transform -translate-y-1/2">
                <div ref={rightLineRef} className="w-8 h-[3px] bg-[#FB2C36] rounded-full origin-right"></div>
              </div>
            </div>
          </div>

          {/* Mobile Layout - Stacked Cards */}
          <div className="md:hidden space-y-6">
            {/* Main Center Card - First on Mobile */}
            <div ref={centerCardRef} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-[0_8px_30px_rgba(213,56,64,0.15)]">
              <h2 className="text-2xl font-bold text-[#000934] mb-3 text-center">
                Meet Verified Students Instantly
              </h2>
              <p className="text-gray-700 mb-6 text-base text-center">
                Safe, real-time video chats with students from your university network
              </p>

              {/* Error Display */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-[#D53840] text-[#D53840] rounded-lg">
                  {error}
                </div>
              )}

              {/* Queue Status Display */}
              <div className="mb-6 p-4 bg-white/60 rounded-xl border border-white/40">
                <div className="flex items-center justify-center space-x-2 mb-2">
                  <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' && matchingStatus === 'idle' ? 'bg-green-500' :
                    connectionStatus === 'searching' || matchingStatus === 'searching' ? 'bg-[#D53840] animate-pulse' :
                      connectionStatus === 'matched' || matchingStatus === 'matched' ? 'bg-green-500' :
                        'bg-red-500'
                    }`}></div>
                  <span className={`text-sm font-medium ${getQueueStatusColor()}`}>
                    {getQueueStatusMessage()}
                  </span>
                </div>

                {/* Additional queue information */}
                {matchingStatus === 'searching' && (
                  <div className="text-xs text-gray-600 mt-2">
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
                  <div className="relative group">
                    {/* Revolving Glowing Border */}
                    <div className="absolute -inset-1 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-[#FB2C36] to-transparent blur-sm"
                        style={{
                          background: 'conic-gradient(from 0deg, transparent, #FB2C36, #E02329, #FB2C36, transparent)',
                          animation: 'spin 2s linear infinite'
                        }}>
                      </div>
                    </div>
                    <button
                      onClick={handleStartMatching}
                      disabled={isMatchingButtonDisabled()}
                      className={`relative w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 ${!isMatchingButtonDisabled()
                        ? 'bg-gradient-to-r from-[#FB2C36] to-[#E02329] hover:from-[#E02329] hover:to-[#D01E24] text-white shadow-lg hover:shadow-2xl hover:shadow-[#FB2C36]/25 transform hover:-translate-y-1 active:translate-y-0 active:shadow-lg'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        }`}
                    >
                      {connectionStatus === 'connected' ? 'Start Matching' : 'Connecting...'}
                    </button>
                  </div>
                )}

                {matchingStatus === 'searching' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-3 p-4 bg-[#D53840]/10 rounded-xl">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#D53840]"></div>
                      <div className="text-center">
                        <p className="text-[#D53840] font-semibold">Searching for student...</p>
                        <p className="text-[#000934] text-sm">{formatSearchDuration(searchDuration)}</p>
                      </div>
                    </div>
                    <button
                      onClick={handleStopMatching}
                      className="w-full py-3 px-6 rounded-xl font-medium bg-[#000934] hover:bg-[#000934]/90 text-white transition-colors"
                    >
                      Cancel Search
                    </button>
                  </div>
                )}

                {matchingStatus === 'matched' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center space-x-3 p-4 bg-green-50 rounded-xl">
                      <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="text-center">
                        <p className="text-green-700 font-semibold">Match found!</p>
                        <p className="text-green-600 text-sm">Preparing video chat...</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Skip/End Info */}
              <p className="text-sm text-gray-600 mt-4 text-center">You can skip or end anytime</p>
            </div>

            {/* Promise and Responsibility Cards - Stacked on Mobile */}
            <div className="space-y-4">
              {/* Our Promise Card */}
              <div ref={leftCardRef} className="bg-gradient-to-br from-[#FB2C36] to-[#E02329] rounded-2xl p-5 shadow-xl">
                <div className="text-center text-white">
                  <div className="flex justify-center mb-3">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-extrabold mb-4">Our Promise</h3>
                  <div className="space-y-2 text-sm leading-snug">
                    <div className="flex items-start space-x-2">
                      <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>We do not record your video</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      <span>We never store or sell your data</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>Profile shared only in matches</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <span>Verified university access only</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Your Responsibility Card */}
              <div ref={rightCardRef} className="bg-gradient-to-bl from-[#FB2C36] to-[#E02329] rounded-2xl p-5 shadow-xl">
                <div className="text-center text-white">
                  <div className="flex justify-center mb-3">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-extrabold mb-4">Your Responsibility</h3>
                  <div className="space-y-2 text-sm leading-snug">
                    <div className="flex items-start space-x-2">
                      <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                      <span>Be respectful to fellow students</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>Keep your camera visible</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L12 21l-6.364-6.364M12 21l6.364-6.364M12 21V9m0 12l-6.364-6.364M12 21l6.364-6.364" />
                      </svg>
                      <span>No harassment or misuse</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Be friendly and professional</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Feature Cards - Responsive */}
          <div ref={bottomCardRef} className="mt-6 md:mt-8 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 max-w-4xl mx-auto px-2 md:px-0">
            {/* Card 1 - University Only */}
            <div className="bg-white rounded-xl p-4 md:p-5 border border-gray-100 shadow-[0_2px_12px_rgba(213,56,64,0.08)]">
              <div className="flex items-center justify-center mb-2 md:mb-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-[#000934] rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-5 md:h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z" />
                  </svg>
                </div>
              </div>
              <h3 className="font-semibold text-[#000934] mb-1 md:mb-2 text-xs md:text-sm text-center">University-Only</h3>
              <p className="text-xs text-gray-600 text-center leading-tight">Only verified .edu / .ac emails allowed</p>
            </div>

            {/* Card 2 - Safe & Moderated */}
            <div className="bg-white rounded-xl p-4 md:p-5 border border-gray-100 shadow-[0_2px_12px_rgba(213,56,64,0.08)]">
              <div className="flex items-center justify-center mb-2 md:mb-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-[#000934] rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-5 md:h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M12,7C13.4,7 14.8,8.6 14.8,10V11.5C15.4,11.5 16,12.4 16,13V16C16,17.4 15.4,18 14.8,18H9.2C8.6,18 8,17.4 8,16V13C8,12.4 8.6,11.5 9.2,11.5V10C9.2,8.6 10.6,7 12,7M12,8.2C11.2,8.2 10.5,8.7 10.5,10V11.5H13.5V10C13.5,8.7 12.8,8.2 12,8.2Z" />
                  </svg>
                </div>
              </div>
              <h3 className="font-semibold text-[#000934] mb-1 md:mb-2 text-xs md:text-sm text-center">Safe & Moderated</h3>
              <p className="text-xs text-gray-600 text-center leading-tight">Report or skip instantly if you feel uncomfortable</p>
            </div>

            {/* Card 3 - Instant Matching */}
            <div className="bg-white rounded-xl p-4 md:p-5 border border-gray-100 shadow-[0_2px_12px_rgba(213,56,64,0.08)]">
              <div className="flex items-center justify-center mb-2 md:mb-3">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-[#000934] rounded-full flex items-center justify-center">
                  <svg className="w-4 h-4 md:w-5 md:h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M7,2V4H8V18A4,4 0 0,0 12,22A4,4 0 0,0 16,18V4H17V2H7M11,16C10.4,16 10,15.6 10,15C10,14.4 10.4,14 11,14C11.6,14 12,14.4 12,15C12,15.6 11.6,16 11,16M13,12C12.4,12 12,11.6 12,11C12,10.4 12.4,10 13,10C13.6,10 14,10.4 14,11C14,11.6 13.6,12 13,12M14,7H10V4H14V7Z" />
                  </svg>
                </div>
              </div>
              <h3 className="font-semibold text-[#000934] mb-1 md:mb-2 text-xs md:text-sm text-center">Instant Matching</h3>
              <p className="text-xs text-gray-600 text-center leading-tight">No profiles, no swiping, just real conversations</p>
            </div>
          </div>

          {/* Privacy Notice */}
          <div className="mt-6 md:mt-8 flex items-center justify-center space-x-2 text-gray-600 px-4">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-xs md:text-sm text-center">Your camera is never shared until you start matching</p>
          </div>
        </div>
      </main>
    </div>
  );
}