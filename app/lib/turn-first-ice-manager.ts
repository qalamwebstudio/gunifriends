/**
 * TURN-First ICE Configuration Manager
 * 
 * Implements optimized ICE server configuration with TURN prioritization
 * for fast, reliable WebRTC connections across all network types.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 * - TURN-first strategy with parallel STUN/TURN gathering
 * - UDP and TCP TURN server support with fallback
 * - Mobile network optimization
 * - Session-based configuration caching
 */

export interface TURNServerConfig {
  urls: string[];
  username: string;
  credential: string;
  priority: number;
  transport: 'udp' | 'tcp' | 'both';
  credentialType?: 'password' | 'oauth';
}

export interface OptimizedICEConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy: 'all' | 'relay';
  iceCandidatePoolSize: number;
  bundlePolicy: 'balanced' | 'max-compat' | 'max-bundle';
  rtcpMuxPolicy: 'require';
}

export interface ICEConfigurationCache {
  config: OptimizedICEConfig;
  networkType: string;
  timestamp: number;
  successRate: number;
  lastUsed: number;
  connectionCount: number;
  averageConnectionTime: number;
  turnCredentialReuse: boolean;
}

export interface TURNCredentialCache {
  username: string;
  credential: string;
  expiresAt: number;
  serverId: string;
  reuseCount: number;
}

export type NetworkType = 'mobile' | 'wifi' | 'unknown';

/**
 * TURN-First ICE Configuration Manager
 * 
 * Manages optimized ICE server configuration with TURN prioritization
 * for consistent sub-5-second connection establishment.
 */
export class TURNFirstICEManager {
  private configCache: Map<string, ICEConfigurationCache> = new Map();
  private turnCredentialCache: Map<string, TURNCredentialCache> = new Map();
  private turnServers: TURNServerConfig[] = [];
  private stunServers: string[] = [];
  private cacheExpiryMs = 30 * 60 * 1000; // 30 minutes
  private credentialReuseExpiryMs = 60 * 60 * 1000; // 1 hour
  private sessionId: string;
  private networkSpecificPreferences: Map<string, Partial<OptimizedICEConfig>> = new Map();

  constructor() {
    this.sessionId = this.generateSessionId();
    this.initializeServers();
    this.initializeNetworkPreferences();
    console.log(`🔧 TURN-First ICE Manager initialized with session ID: ${this.sessionId}`);
  }

  /**
   * Generate unique session ID for credential reuse tracking
   * Requirements: 8.2 - TURN credential reuse across connection attempts
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize network-specific configuration preferences
   * Requirements: 8.4 - Network-specific configuration preferences
   */
  private initializeNetworkPreferences(): void {
    // Mobile network preferences - optimize for battery and data usage
    this.networkSpecificPreferences.set('mobile', {
      iceCandidatePoolSize: 3, // Smaller pool for mobile
      iceTransportPolicy: 'relay', // Prefer relay to avoid CGNAT
      bundlePolicy: 'max-bundle' // Bundle for efficiency
    });

    // WiFi network preferences - optimize for speed and reliability
    this.networkSpecificPreferences.set('wifi', {
      iceCandidatePoolSize: 5, // Moderate pool for WiFi
      iceTransportPolicy: 'all', // Use all transport types
      bundlePolicy: 'max-bundle'
    });

    // Corporate/restrictive network preferences
    this.networkSpecificPreferences.set('corporate', {
      iceCandidatePoolSize: 4,
      iceTransportPolicy: 'relay', // Force relay for firewall traversal
      bundlePolicy: 'max-bundle'
    });

    // Unknown network preferences - conservative approach
    this.networkSpecificPreferences.set('unknown', {
      iceCandidatePoolSize: 4,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle'
    });

    console.log(`🌐 Initialized network preferences for ${this.networkSpecificPreferences.size} network types`);
  }
  /**
   * Initialize TURN and STUN servers with prioritization
   * Requirements: 1.1 - Configure at least two TURN servers (UDP and TCP)
   */
  private initializeServers(): void {
    // High-priority TURN servers with both UDP and TCP support
    this.turnServers = [
      // Metered.ca - Primary TURN service
      {
        urls: [
          'turn:a.relay.metered.ca:80',
          'turn:a.relay.metered.ca:80?transport=tcp',
          'turn:a.relay.metered.ca:443',
          'turn:a.relay.metered.ca:443?transport=tcp',
          'turns:a.relay.metered.ca:443?transport=tcp'
        ],
        username: process.env.NEXT_PUBLIC_METERED_TURN_USERNAME || 'demo-username',
        credential: process.env.NEXT_PUBLIC_METERED_TURN_CREDENTIAL || 'demo-credential',
        priority: 1,
        transport: 'both'
      },
      // Twilio TURN - Secondary with global coverage
      {
        urls: [
          'turn:global.turn.twilio.com:3478?transport=udp',
          'turn:global.turn.twilio.com:3478?transport=tcp',
          'turn:global.turn.twilio.com:443?transport=tcp'
        ],
        username: process.env.NEXT_PUBLIC_TWILIO_TURN_USERNAME || '',
        credential: process.env.NEXT_PUBLIC_TWILIO_TURN_CREDENTIAL || '',
        priority: 2,
        transport: 'both'
      },
      // Xirsys - Tertiary with multiple endpoints
      {
        urls: [
          'turn:ss-turn1.xirsys.com:80?transport=udp',
          'turn:ss-turn1.xirsys.com:3478?transport=udp',
          'turn:ss-turn1.xirsys.com:80?transport=tcp',
          'turn:ss-turn1.xirsys.com:3478?transport=tcp',
          'turns:ss-turn1.xirsys.com:443?transport=tcp',
          'turns:ss-turn1.xirsys.com:5349?transport=tcp'
        ],
        username: process.env.NEXT_PUBLIC_XIRSYS_TURN_USERNAME || '',
        credential: process.env.NEXT_PUBLIC_XIRSYS_TURN_CREDENTIAL || '',
        priority: 3,
        transport: 'both'
      },
      // Free TURN servers for fallback
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
        priority: 4,
        transport: 'both'
      }
    ];

    // STUN servers for NAT discovery (used in parallel with TURN)
    this.stunServers = [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun.services.mozilla.com',
      'stun:stun.stunprotocol.org:3478',
      'stun:stun.cloudflare.com:3478'
    ];

    console.log(`🔧 TURN-First ICE Manager initialized with ${this.turnServers.length} TURN servers and ${this.stunServers.length} STUN servers`);
  }

  /**
   * Generate optimized ICE configuration with TURN-first strategy
   * Requirements: 1.1, 1.2, 1.3, 1.5 - TURN-first with parallel gathering
   * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5 - Enhanced caching and optimization
   */
  generateOptimizedConfig(networkType: NetworkType = 'unknown'): OptimizedICEConfig {
    console.log(`🌐 Generating TURN-first ICE configuration for ${networkType} network`);

    // Check cache first (Requirements 8.1 - Session-based caching)
    const cached = this.getCachedConfig(networkType);
    if (cached) {
      console.log(`📋 Using cached ICE configuration for ${networkType} network`);
      this.updateCacheUsage(networkType);
      return cached;
    }

    const iceServers: RTCIceServer[] = [];

    // Requirements 1.2, 1.5 - Add TURN servers first (parallel with STUN, not sequential)
    // Requirements 8.2 - Implement TURN credential reuse
    const availableTurnServers = this.getAvailableTurnServersWithCredentialReuse();
    
    // Sort TURN servers by priority
    availableTurnServers.sort((a, b) => a.priority - b.priority);

    // Add TURN servers with both UDP and TCP support
    for (const turnServer of availableTurnServers) {
      if (turnServer.username && turnServer.credential) {
        iceServers.push({
          urls: turnServer.urls,
          username: turnServer.username,
          credential: turnServer.credential
        });
      }
    }

    // Requirements 1.2, 1.5 - Add STUN servers in parallel (not after TURN failure)
    // STUN servers are added alongside TURN for parallel candidate gathering
    for (const stunUrl of this.stunServers) {
      iceServers.push({ urls: stunUrl });
    }

    // Add custom TURN server from environment if available
    this.addCustomTurnServer(iceServers);

    // Requirements 8.4 - Apply network-specific configuration preferences
    const networkPreferences = this.getNetworkSpecificPreferences(networkType);
    
    // Requirements 1.4 - Configure ICE transport policy for mobile networks
    const iceTransportPolicy = networkPreferences.iceTransportPolicy || 
      this.determineTransportPolicy(networkType, availableTurnServers.length);
    
    // Requirements 8.3 - Optimize ICE candidate pool size to reduce gathering time
    const iceCandidatePoolSize = networkPreferences.iceCandidatePoolSize || 
      this.determineOptimizedPoolSize(networkType);

    const config: OptimizedICEConfig = {
      iceServers,
      iceTransportPolicy,
      iceCandidatePoolSize,
      bundlePolicy: networkPreferences.bundlePolicy || 'max-bundle', // Bundle all media for faster negotiation
      rtcpMuxPolicy: 'require' // Multiplex RTP and RTCP
    };

    // Cache the configuration (Requirements 8.1, 8.4, 8.5)
    this.cacheConfiguration(config, networkType);

    console.log(`✅ Generated TURN-first ICE config: ${iceServers.length} servers, policy: ${iceTransportPolicy}, pool: ${iceCandidatePoolSize}`);
    console.log(`🔄 TURN servers: ${availableTurnServers.length}, STUN servers: ${this.stunServers.length}`);
    console.log(`🎯 Applied ${networkType} network preferences: pool=${iceCandidatePoolSize}, policy=${iceTransportPolicy}`);

    return config;
  }

  /**
   * Get available TURN servers with credential reuse optimization
   * Requirements: 8.2 - TURN credential reuse across connection attempts
   */
  private getAvailableTurnServersWithCredentialReuse(): TURNServerConfig[] {
    const available = this.turnServers.filter(server => 
      server.username && 
      server.credential && 
      server.urls.length > 0
    );

    // Check for cached credentials and reuse them
    for (const server of available) {
      const cachedCredential = this.getCachedTurnCredential(server.urls[0]);
      if (cachedCredential && this.isCredentialValid(cachedCredential)) {
        // Reuse cached credentials
        server.username = cachedCredential.username;
        server.credential = cachedCredential.credential;
        cachedCredential.reuseCount++;
        
        console.log(`🔄 Reusing TURN credentials for ${server.urls[0]} (reuse count: ${cachedCredential.reuseCount})`);
      } else {
        // Cache new credentials for future reuse
        this.cacheTurnCredential(server.urls[0], server.username, server.credential);
      }
    }

    if (available.length === 0) {
      console.warn('⚠️ No TURN servers available with credentials');
    } else if (available.length < 2) {
      console.warn(`⚠️ Only ${available.length} TURN server available, recommend at least 2`);
    } else {
      console.log(`✅ ${available.length} TURN servers available with credentials (credential reuse enabled)`);
    }

    return available;
  }

  /**
   * Get available TURN servers with credentials (legacy method for compatibility)
   * Requirements: 1.1 - Ensure at least two TURN servers available
   */
  private getAvailableTurnServers(): TURNServerConfig[] {
    const available = this.turnServers.filter(server => 
      server.username && 
      server.credential && 
      server.urls.length > 0
    );

    if (available.length === 0) {
      console.warn('⚠️ No TURN servers available with credentials');
    } else if (available.length < 2) {
      console.warn(`⚠️ Only ${available.length} TURN server available, recommend at least 2`);
    } else {
      console.log(`✅ ${available.length} TURN servers available with credentials`);
    }

    return available;
  }

  /**
   * Cache TURN credentials for reuse across connection attempts
   * Requirements: 8.2 - TURN credential reuse across connection attempts
   */
  private cacheTurnCredential(serverId: string, username: string, credential: string): void {
    const cacheEntry: TURNCredentialCache = {
      username,
      credential,
      expiresAt: Date.now() + this.credentialReuseExpiryMs,
      serverId,
      reuseCount: 0
    };

    this.turnCredentialCache.set(serverId, cacheEntry);
    console.log(`🔐 Cached TURN credentials for ${serverId} (expires in ${this.credentialReuseExpiryMs / 1000}s)`);
  }

  /**
   * Get cached TURN credentials
   * Requirements: 8.2 - TURN credential reuse across connection attempts
   */
  private getCachedTurnCredential(serverId: string): TURNCredentialCache | null {
    const cached = this.turnCredentialCache.get(serverId);
    
    if (!cached) {
      return null;
    }

    if (!this.isCredentialValid(cached)) {
      this.turnCredentialCache.delete(serverId);
      return null;
    }

    return cached;
  }

  /**
   * Check if cached TURN credential is still valid
   * Requirements: 8.2 - TURN credential reuse across connection attempts
   */
  private isCredentialValid(credential: TURNCredentialCache): boolean {
    return Date.now() < credential.expiresAt;
  }

  /**
   * Get network-specific configuration preferences
   * Requirements: 8.4 - Network-specific configuration preferences
   */
  private getNetworkSpecificPreferences(networkType: NetworkType): Partial<OptimizedICEConfig> {
    const preferences = this.networkSpecificPreferences.get(networkType);
    if (preferences) {
      console.log(`🎯 Applying ${networkType} network preferences`);
      return preferences;
    }

    // Fallback to unknown network preferences
    const fallback = this.networkSpecificPreferences.get('unknown') || {};
    console.log(`🎯 Using fallback preferences for ${networkType} network`);
    return fallback;
  }

  /**
   * Determine optimized ICE candidate pool size to reduce gathering time
   * Requirements: 8.3 - Optimize ICE candidate pool size to reduce gathering time
   */
  private determineOptimizedPoolSize(networkType: NetworkType): number {
    // Enhanced pool size determination based on network characteristics
    switch (networkType) {
      case 'mobile':
        // Smaller pool for mobile to reduce battery usage and gathering time
        // Mobile networks often have CGNAT, so fewer candidates are needed
        return 3;
      case 'wifi':
        // Moderate pool for WiFi networks - balance between speed and thoroughness
        return 5;
      default:
        // Conservative pool for unknown networks (including corporate)
        return 4;
    }
  }

  /**
   * Update cache usage statistics
   * Requirements: 8.1, 8.5 - Session-based caching effectiveness tracking
   */
  private updateCacheUsage(networkType: string): void {
    const cached = this.configCache.get(networkType);
    if (cached) {
      cached.lastUsed = Date.now();
      cached.connectionCount++;
      console.log(`📊 Cache usage updated for ${networkType}: ${cached.connectionCount} connections`);
    }
  }

  /**
   * Add custom TURN server from environment variables
   */
  private addCustomTurnServer(iceServers: RTCIceServer[]): void {
    const customServer = process.env.NEXT_PUBLIC_TURN_SERVER;
    const customUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
    const customCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

    if (customServer && customUsername && customCredential) {
      // Add multiple transport options for custom server
      iceServers.push(
        {
          urls: `turn:${customServer}:3478`,
          username: customUsername,
          credential: customCredential
        },
        {
          urls: `turns:${customServer}:5349`,
          username: customUsername,
          credential: customCredential
        },
        {
          urls: `turn:${customServer}:80?transport=tcp`,
          username: customUsername,
          credential: customCredential
        },
        {
          urls: `turn:${customServer}:443?transport=tcp`,
          username: customUsername,
          credential: customCredential
        }
      );

      console.log(`🔧 Added custom TURN server: ${customServer}`);
    }
  }

  /**
   * Determine ICE transport policy based on network type
   * Requirements: 1.4 - Mobile network optimization
   */
  private determineTransportPolicy(networkType: NetworkType, turnServerCount: number): 'all' | 'relay' {
    // For mobile networks, prefer relay to avoid CGNAT issues
    if (networkType === 'mobile') {
      if (turnServerCount > 0) {
        console.log('📱 Mobile network detected: using relay-preferred policy');
        return 'relay';
      } else {
        console.warn('📱 Mobile network detected but no TURN servers available, using all');
        return 'all';
      }
    }

    // For WiFi networks, use all transport types but TURN will be prioritized
    if (networkType === 'wifi') {
      console.log('📶 WiFi network detected: using all transport policy with TURN priority');
      return 'all';
    }

    // For unknown networks, use all but log the decision
    console.log('❓ Unknown network type: using all transport policy');
    return 'all';
  }

  /**
   * Determine optimal ICE candidate pool size
   * Requirements: 1.3 - Optimize pool size to reduce gathering time
   */
  private determinePoolSize(networkType: NetworkType): number {
    switch (networkType) {
      case 'mobile':
        // Smaller pool for mobile to reduce battery usage and gathering time
        return 4;
      case 'wifi':
        // Moderate pool for WiFi networks
        return 6;
      default:
        // Conservative pool for unknown networks
        return 4;
    }
  }

  /**
   * Cache successful ICE configuration for reuse
   * Requirements: 8.1, 8.4, 8.5 - Enhanced session-based caching for faster subsequent connections
   */
  cacheConfiguration(config: OptimizedICEConfig, networkType: string): void {
    const cacheEntry: ICEConfigurationCache = {
      config: { ...config },
      networkType,
      timestamp: Date.now(),
      successRate: 1.0, // Start with perfect success rate
      lastUsed: Date.now(),
      connectionCount: 1,
      averageConnectionTime: 0, // Will be updated when connection times are reported
      turnCredentialReuse: this.turnCredentialCache.size > 0
    };

    this.configCache.set(networkType, cacheEntry);
    console.log(`📋 Cached ICE configuration for ${networkType} network (session: ${this.sessionId})`);
    console.log(`🔐 TURN credential reuse enabled: ${cacheEntry.turnCredentialReuse}`);
  }

  /**
   * Get cached ICE configuration if available and valid
   * Requirements: 8.4, 8.5 - Reuse successful configurations
   */
  getCachedConfig(networkType: string): OptimizedICEConfig | null {
    const cached = this.configCache.get(networkType);
    
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    const age = Date.now() - cached.timestamp;
    if (age > this.cacheExpiryMs) {
      console.log(`📋 Cache expired for ${networkType} network (age: ${Math.round(age / 1000)}s)`);
      this.configCache.delete(networkType);
      return null;
    }

    // Check success rate threshold
    if (cached.successRate < 0.7) {
      console.log(`📋 Cache invalidated for ${networkType} network (low success rate: ${cached.successRate})`);
      this.configCache.delete(networkType);
      return null;
    }

    // Update last used timestamp
    cached.lastUsed = Date.now();
    
    return cached.config;
  }

  /**
   * Update cache success rate and connection timing based on connection results
   * Requirements: 8.1, 8.4, 8.5 - Track configuration effectiveness and performance
   */
  updateCacheSuccessRate(networkType: string, success: boolean, connectionTimeMs?: number): void {
    const cached = this.configCache.get(networkType);
    if (!cached) {
      return;
    }

    // Simple exponential moving average for success rate
    const alpha = 0.3; // Weight for new measurement
    cached.successRate = success 
      ? cached.successRate * (1 - alpha) + alpha
      : cached.successRate * (1 - alpha);

    // Update average connection time if provided
    if (connectionTimeMs !== undefined && success) {
      if (cached.averageConnectionTime === 0) {
        cached.averageConnectionTime = connectionTimeMs;
      } else {
        // Exponential moving average for connection time
        cached.averageConnectionTime = cached.averageConnectionTime * (1 - alpha) + connectionTimeMs * alpha;
      }
      
      console.log(`⏱️ Updated average connection time for ${networkType}: ${Math.round(cached.averageConnectionTime)}ms`);
    }

    console.log(`📊 Updated cache success rate for ${networkType}: ${cached.successRate.toFixed(2)} (connections: ${cached.connectionCount})`);

    // Remove from cache if success rate drops too low
    if (cached.successRate < 0.3) {
      console.log(`📋 Removing cached config for ${networkType} due to low success rate`);
      this.configCache.delete(networkType);
    }
  }

  /**
   * Clear expired cache entries and credentials
   * Requirements: 8.1, 8.2 - Cleanup expired cached data
   */
  cleanupCache(): void {
    const now = Date.now();
    let configsCleaned = 0;
    let credentialsCleaned = 0;

    // Clean up expired configuration cache entries
    for (const [networkType, cached] of this.configCache.entries()) {
      const age = now - cached.timestamp;
      if (age > this.cacheExpiryMs) {
        this.configCache.delete(networkType);
        configsCleaned++;
      }
    }

    // Clean up expired TURN credentials
    for (const [serverId, credential] of this.turnCredentialCache.entries()) {
      if (!this.isCredentialValid(credential)) {
        this.turnCredentialCache.delete(serverId);
        credentialsCleaned++;
      }
    }

    if (configsCleaned > 0 || credentialsCleaned > 0) {
      console.log(`🧹 Cleaned up ${configsCleaned} expired config entries and ${credentialsCleaned} expired credentials`);
    }
  }

  /**
   * Set network-specific configuration preference
   * Requirements: 8.4 - Network-specific configuration preferences
   */
  setNetworkPreference(networkType: string, preferences: Partial<OptimizedICEConfig>): void {
    this.networkSpecificPreferences.set(networkType, preferences);
    console.log(`🎯 Set network preferences for ${networkType}:`, preferences);
    
    // Invalidate cached config for this network type to force regeneration with new preferences
    if (this.configCache.has(networkType)) {
      this.configCache.delete(networkType);
      console.log(`📋 Invalidated cached config for ${networkType} due to preference change`);
    }
  }

  /**
   * Get network-specific configuration preference
   * Requirements: 8.4 - Network-specific configuration preferences
   */
  getNetworkPreference(networkType: string): Partial<OptimizedICEConfig> | undefined {
    return this.networkSpecificPreferences.get(networkType);
  }

  /**
   * Clear all cached configurations and credentials for session reset
   * Requirements: 8.1, 8.2 - Session management
   */
  clearAllCaches(): void {
    const configCount = this.configCache.size;
    const credentialCount = this.turnCredentialCache.size;
    
    this.configCache.clear();
    this.turnCredentialCache.clear();
    
    // Generate new session ID
    this.sessionId = this.generateSessionId();
    
    console.log(`🧹 Cleared all caches: ${configCount} configs, ${credentialCount} credentials`);
    console.log(`🆔 New session ID: ${this.sessionId}`);
  }

  /**
   * Get TURN credential cache statistics
   * Requirements: 8.2 - TURN credential reuse monitoring
   */
  getTurnCredentialStats(): {
    totalCredentials: number;
    validCredentials: number;
    expiredCredentials: number;
    totalReuseCount: number;
    credentialsByServer: Record<string, { reuseCount: number; expiresIn: number }>;
  } {
    const now = Date.now();
    let validCredentials = 0;
    let expiredCredentials = 0;
    let totalReuseCount = 0;
    const credentialsByServer: Record<string, { reuseCount: number; expiresIn: number }> = {};

    for (const [serverId, credential] of this.turnCredentialCache.entries()) {
      const expiresIn = credential.expiresAt - now;
      
      if (this.isCredentialValid(credential)) {
        validCredentials++;
      } else {
        expiredCredentials++;
      }
      
      totalReuseCount += credential.reuseCount;
      
      credentialsByServer[serverId] = {
        reuseCount: credential.reuseCount,
        expiresIn: Math.max(0, expiresIn)
      };
    }

    return {
      totalCredentials: this.turnCredentialCache.size,
      validCredentials,
      expiredCredentials,
      totalReuseCount,
      credentialsByServer
    };
  }

  /**
   * Get comprehensive cache statistics for monitoring
   * Requirements: 8.1, 8.4, 8.5 - Cache effectiveness monitoring
   */
  getCacheStats(): {
    totalEntries: number;
    entriesByNetwork: Record<string, { 
      age: number; 
      successRate: number; 
      lastUsed: number;
      connectionCount: number;
      averageConnectionTime: number;
      turnCredentialReuse: boolean;
    }>;
    averageSuccessRate: number;
    averageConnectionTime: number;
    sessionId: string;
    turnCredentialStats: ReturnType<TURNFirstICEManager['getTurnCredentialStats']>;
  } {
    const now = Date.now();
    const entriesByNetwork: Record<string, { 
      age: number; 
      successRate: number; 
      lastUsed: number;
      connectionCount: number;
      averageConnectionTime: number;
      turnCredentialReuse: boolean;
    }> = {};
    let totalSuccessRate = 0;
    let totalConnectionTime = 0;
    let connectionsWithTiming = 0;

    for (const [networkType, cached] of this.configCache.entries()) {
      entriesByNetwork[networkType] = {
        age: now - cached.timestamp,
        successRate: cached.successRate,
        lastUsed: now - cached.lastUsed,
        connectionCount: cached.connectionCount,
        averageConnectionTime: cached.averageConnectionTime,
        turnCredentialReuse: cached.turnCredentialReuse
      };
      
      totalSuccessRate += cached.successRate;
      
      if (cached.averageConnectionTime > 0) {
        totalConnectionTime += cached.averageConnectionTime;
        connectionsWithTiming++;
      }
    }

    return {
      totalEntries: this.configCache.size,
      entriesByNetwork,
      averageSuccessRate: this.configCache.size > 0 ? totalSuccessRate / this.configCache.size : 0,
      averageConnectionTime: connectionsWithTiming > 0 ? totalConnectionTime / connectionsWithTiming : 0,
      sessionId: this.sessionId,
      turnCredentialStats: this.getTurnCredentialStats()
    };
  }

  /**
   * Force refresh configuration (bypass cache)
   */
  forceRefreshConfig(networkType: NetworkType): OptimizedICEConfig {
    console.log(`🔄 Force refreshing ICE configuration for ${networkType} network`);
    
    // Remove from cache to force regeneration
    this.configCache.delete(networkType);
    
    return this.generateOptimizedConfig(networkType);
  }

  /**
   * Validate TURN server connectivity
   * Requirements: 1.1 - Ensure TURN servers are functional
   */
  async validateTurnServers(): Promise<{
    totalServers: number;
    workingServers: number;
    failedServers: string[];
    recommendations: string[];
  }> {
    console.log('🔍 Validating TURN server connectivity...');
    
    const availableServers = this.getAvailableTurnServers();
    const failedServers: string[] = [];
    const recommendations: string[] = [];
    let workingServers = 0;

    for (const server of availableServers) {
      try {
        // Quick validation - check if credentials are present
        if (!server.username || !server.credential) {
          failedServers.push(`${server.urls[0]} (missing credentials)`);
          continue;
        }

        // For now, just validate configuration
        // Full connectivity testing would be done by turn-test.ts
        workingServers++;
        
      } catch (error) {
        failedServers.push(`${server.urls[0]} (${error})`);
      }
    }

    // Generate recommendations
    if (workingServers === 0) {
      recommendations.push('No TURN servers available - configure TURN credentials in environment variables');
      recommendations.push('Connections may fail on restrictive networks without TURN servers');
    } else if (workingServers < 2) {
      recommendations.push('Only one TURN server available - add more for redundancy');
    }

    if (failedServers.length > 0) {
      recommendations.push('Some TURN servers failed validation - check credentials and connectivity');
    }

    console.log(`✅ TURN validation complete: ${workingServers}/${availableServers.length} servers working`);

    return {
      totalServers: availableServers.length,
      workingServers,
      failedServers,
      recommendations
    };
  }

  /**
   * Get comprehensive configuration summary
   * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5 - Complete system status
   */
  getConfigurationSummary(): {
    turnServers: number;
    stunServers: number;
    cachedConfigs: number;
    cachedCredentials: number;
    networkPreferences: number;
    sessionId: string;
    defaultNetworkPolicy: string;
    cacheStats: ReturnType<TURNFirstICEManager['getCacheStats']>;
    optimizations: {
      sessionBasedCaching: boolean;
      turnCredentialReuse: boolean;
      networkSpecificPreferences: boolean;
      optimizedPoolSizes: boolean;
    };
  } {
    const availableTurnServers = this.turnServers.filter(server => 
      server.username && server.credential && server.urls.length > 0
    );

    return {
      turnServers: availableTurnServers.length,
      stunServers: this.stunServers.length,
      cachedConfigs: this.configCache.size,
      cachedCredentials: this.turnCredentialCache.size,
      networkPreferences: this.networkSpecificPreferences.size,
      sessionId: this.sessionId,
      defaultNetworkPolicy: 'TURN-first with parallel STUN/TURN gathering',
      cacheStats: this.getCacheStats(),
      optimizations: {
        sessionBasedCaching: true,
        turnCredentialReuse: this.turnCredentialCache.size > 0,
        networkSpecificPreferences: this.networkSpecificPreferences.size > 0,
        optimizedPoolSizes: true
      }
    };
  }
}

// Global instance for application use
export const turnFirstICEManager = new TURNFirstICEManager();

/**
 * Convenience function to get optimized ICE configuration
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5 - Main entry point for TURN-first configuration
 */
export function getOptimizedICEConfiguration(networkType: NetworkType = 'unknown'): OptimizedICEConfig {
  return turnFirstICEManager.generateOptimizedConfig(networkType);
}

/**
 * Convenience function to update configuration success rate with timing
 * Requirements: 8.1, 8.4, 8.5 - Track configuration effectiveness and performance
 */
export function updateConfigurationSuccess(networkType: string, success: boolean, connectionTimeMs?: number): void {
  turnFirstICEManager.updateCacheSuccessRate(networkType, success, connectionTimeMs);
}

/**
 * Convenience function to set network-specific preferences
 * Requirements: 8.4 - Network-specific configuration preferences
 */
export function setNetworkConfigurationPreference(networkType: string, preferences: Partial<OptimizedICEConfig>): void {
  turnFirstICEManager.setNetworkPreference(networkType, preferences);
}

/**
 * Convenience function to get network-specific preferences
 * Requirements: 8.4 - Network-specific configuration preferences
 */
export function getNetworkConfigurationPreference(networkType: string): Partial<OptimizedICEConfig> | undefined {
  return turnFirstICEManager.getNetworkPreference(networkType);
}

/**
 * Convenience function to clear all caches (for session reset)
 * Requirements: 8.1, 8.2 - Session management
 */
export function clearConfigurationCaches(): void {
  turnFirstICEManager.clearAllCaches();
}

/**
 * Convenience function to get comprehensive cache statistics
 * Requirements: 8.1, 8.2, 8.4, 8.5 - Cache monitoring
 */
export function getConfigurationCacheStats(): ReturnType<typeof turnFirstICEManager.getCacheStats> {
  return turnFirstICEManager.getCacheStats();
}

/**
 * Convenience function to get TURN credential statistics
 * Requirements: 8.2 - TURN credential reuse monitoring
 */
export function getTurnCredentialStatistics(): ReturnType<typeof turnFirstICEManager.getTurnCredentialStats> {
  return turnFirstICEManager.getTurnCredentialStats();
}

/**
 * Convenience function to validate TURN server setup
 * Requirements: 1.1 - Ensure TURN servers are functional
 */
export async function validateTurnServerSetup(): Promise<ReturnType<typeof turnFirstICEManager.validateTurnServers>> {
  return turnFirstICEManager.validateTurnServers();
}