// User and Authentication Types
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  university: string;
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  passwordResetToken?: string;
  passwordResetExpiresAt?: Date;
  createdAt: Date;
  lastActiveAt: Date;
  reportCount: number;
  isActive: boolean;
}

export interface Session {
  id: string;
  userId: string;
  socketId: string;
  status: 'waiting' | 'matched' | 'in-call';
  matchedWith?: string;
  joinedAt: Date;
  lastActivity: Date;
  // Session persistence fields (Requirements 8.4, 8.5)
  reconnectionAttempts?: number;
  lastDisconnectedAt?: Date;
  isReconnecting?: boolean;
}

export interface Report {
  id: string;
  reporterId: string;
  reportedUserId: string;
  category: 'inappropriate-behavior' | 'harassment' | 'spam' | 'other';
  description: string;
  timestamp: Date;
  status: 'pending' | 'reviewed' | 'resolved';
  sessionId?: string;
}

export interface Match {
  id: string;
  user1Id: string;
  user2Id: string;
  startedAt: Date;
  endedAt?: Date;
  endReason?: 'normal' | 'report' | 'skip' | 'disconnect' | 'timeout';
  duration?: number;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AuthResponse {
  user: Omit<User, 'passwordHash'>;
  token: string;
}

// Socket.io Event Types
export interface ServerToClientEvents {
  'match-found': (matchData: { partnerId: string; roomId: string }) => void;
  'partner-disconnected': () => void;
  'partner-timeout': () => void;
  'partner-temporarily-disconnected': (data: { partnerId: string; reason: string }) => void;
  'partner-reconnected': (data: { partnerId: string }) => void;
  'partner-network-recovered': (data: { partnerId: string }) => void;
  'partner-came-online': (data: { partnerId: string }) => void;
  'partner-attempting-restore': (data: { partnerId: string; partnerEmail: string }) => void;
  'partner-video-started': () => void;
  'session-timeout': () => void;
  'session-restored': (data: {
    partnerId: string;
    roomId: string;
    wasReconnected: boolean;
    partnerLastSeen?: Date;
    sessionAge?: number;
  }) => void;
  'session-restore-failed': (data: { reason: string }) => void;
  'heartbeat-ack': (data: {
    timestamp: Date;
    sessionActive: boolean;
    partnerId?: string;
    roomId?: string;
    connectionQuality?: 'good' | 'fair' | 'poor';
  }) => void;
  'offer': (offer: RTCSessionDescriptionInit) => void;
  'answer': (answer: RTCSessionDescriptionInit) => void;
  'ice-candidate': (candidate: RTCIceCandidateInit) => void;
  'call-ended': () => void;
  'error': (error: string) => void;
  'media-state-change': (data: { type: 'audio' | 'video' | 'speaker'; enabled: boolean }) => void;
}

export interface ClientToServerEvents {
  'join-matching-pool': () => void;
  'leave-matching-pool': () => void;
  'heartbeat': (data?: {
    isVisible?: boolean;
    connectionQuality?: 'good' | 'fair' | 'poor';
    isInActiveCall?: boolean;
    networkRecovered?: boolean;
    isOnline?: boolean;
    timestamp?: number;
  }) => void;
  'browser-closing': () => void;
  'request-session-restore': () => void;
  'offer': (offer: RTCSessionDescriptionInit) => void;
  'answer': (answer: RTCSessionDescriptionInit) => void;
  'ice-candidate': (candidate: RTCIceCandidateInit) => void;
  'media-state-change': (data: { type: 'audio' | 'video' | 'speaker'; enabled: boolean }) => void;
  'end-call': () => void;
  'report-user': (data: { reportedUserId: string; category: string; description: string }) => void;
  'skip-user': () => void;
  'video-call-started': () => void;
  'webrtc-connection-state': (data: { connectionState: string; iceConnectionState: string }) => void;
}

// University Configuration
export interface UniversityConfig {
  domains: string[];
  name: string;
}

export const UNIVERSITY_DOMAINS: UniversityConfig[] = [
  { name: 'Ganpat University', domains: ['gnu.ac.in'] },
];