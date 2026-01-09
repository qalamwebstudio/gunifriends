/**
 * TURN-First ICE Manager Tests
 * 
 * Tests for the TURN-first ICE configuration manager
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { 
  TURNFirstICEManager, 
  turnFirstICEManager,
  getOptimizedICEConfiguration,
  updateConfigurationSuccess,
  validateTurnServerSetup
} from './turn-first-ice-manager';

// Mock environment variables for testing
const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_METERED_TURN_USERNAME: 'test-username',
    NEXT_PUBLIC_METERED_TURN_CREDENTIAL: 'test-credential'
  };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('TURN-First ICE Manager', () => {
  describe('Basic Configuration Generation', () => {
    test('should generate ICE configuration with TURN servers first', () => {
      const config = getOptimizedICEConfiguration('wifi');
      
      expect(config).toBeDefined();
      expect(config.iceServers).toBeDefined();
      expect(config.iceServers.length).toBeGreaterThan(0);
      
      // Should have both TURN and STUN servers
      const turnServers = config.iceServers.filter(server => 
        (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('turn')) : server.urls.startsWith('turn'))
      );
      const stunServers = config.iceServers.filter(server => 
        (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('stun')) : server.urls.startsWith('stun'))
      );
      
      expect(turnServers.length).toBeGreaterThan(0);
      expect(stunServers.length).toBeGreaterThan(0);
      
      console.log(`Generated config with ${turnServers.length} TURN servers and ${stunServers.length} STUN servers`);
    });

    test('should configure different policies for different network types', () => {
      const mobileConfig = getOptimizedICEConfiguration('mobile');
      const wifiConfig = getOptimizedICEConfiguration('wifi');
      const unknownConfig = getOptimizedICEConfiguration('unknown');
      
      expect(mobileConfig.iceTransportPolicy).toBe('relay'); // Mobile should prefer relay
      expect(wifiConfig.iceTransportPolicy).toBe('all'); // WiFi can use all
      expect(unknownConfig.iceTransportPolicy).toBe('all'); // Unknown defaults to all
      
      // Mobile should have smaller candidate pool
      expect(mobileConfig.iceCandidatePoolSize).toBeLessThanOrEqual(wifiConfig.iceCandidatePoolSize);
    });

    test('should include required ICE server properties', () => {
      const config = getOptimizedICEConfiguration('wifi');
      
      expect(config.bundlePolicy).toBe('max-bundle');
      expect(config.rtcpMuxPolicy).toBe('require');
      expect(typeof config.iceCandidatePoolSize).toBe('number');
      expect(config.iceCandidatePoolSize).toBeGreaterThan(0);
    });
  });

  describe('TURN Server Configuration', () => {
    test('should include TURN servers with credentials', () => {
      const config = getOptimizedICEConfiguration('wifi');
      
      const turnServers = config.iceServers.filter(server => 
        server.username && server.credential &&
        (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('turn')) : server.urls.startsWith('turn'))
      );
      
      expect(turnServers.length).toBeGreaterThan(0);
      
      // Check that TURN servers have required properties
      turnServers.forEach(server => {
        expect(server.username).toBeDefined();
        expect(server.credential).toBeDefined();
        expect(server.urls).toBeDefined();
      });
    });

    test('should validate TURN server setup', async () => {
      const validation = await validateTurnServerSetup();
      
      expect(validation).toBeDefined();
      expect(typeof validation.totalServers).toBe('number');
      expect(typeof validation.workingServers).toBe('number');
      expect(Array.isArray(validation.failedServers)).toBe(true);
      expect(Array.isArray(validation.recommendations)).toBe(true);
      
      // Should have at least one working server with our test credentials
      expect(validation.workingServers).toBeGreaterThan(0);
    });
  });

  describe('Configuration Caching', () => {
    test('should cache and reuse configurations', () => {
      const manager = new TURNFirstICEManager();
      
      // Generate initial configuration
      const config1 = manager.generateOptimizedConfig('wifi');
      
      // Generate again - should use cache
      const config2 = manager.generateOptimizedConfig('wifi');
      
      // Should be the same configuration (from cache)
      expect(config1).toEqual(config2);
      
      // Check cache stats
      const stats = manager.getCacheStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.entriesByNetwork['wifi']).toBeDefined();
    });

    test('should update cache success rates', () => {
      const manager = new TURNFirstICEManager();
      
      // Generate configuration to create cache entry
      manager.generateOptimizedConfig('wifi');
      
      // Update success rate
      manager.updateCacheSuccessRate('wifi', true);
      manager.updateCacheSuccessRate('wifi', false);
      
      const stats = manager.getCacheStats();
      expect(stats.entriesByNetwork['wifi'].successRate).toBeLessThan(1.0);
    });

    test('should force refresh configuration', () => {
      const manager = new TURNFirstICEManager();
      
      // Generate and cache configuration
      const config1 = manager.generateOptimizedConfig('wifi');
      
      // Force refresh should bypass cache
      const config2 = manager.forceRefreshConfig('wifi');
      
      // Should be equivalent but not from cache
      expect(config1.iceServers.length).toBe(config2.iceServers.length);
      expect(config1.iceTransportPolicy).toBe(config2.iceTransportPolicy);
    });
  });

  describe('Network Type Optimization', () => {
    test('should optimize for mobile networks', () => {
      const config = getOptimizedICEConfiguration('mobile');
      
      // Mobile should prefer relay and have smaller candidate pool
      expect(config.iceTransportPolicy).toBe('relay');
      expect(config.iceCandidatePoolSize).toBeLessThanOrEqual(4);
    });

    test('should optimize for WiFi networks', () => {
      const config = getOptimizedICEConfiguration('wifi');
      
      // WiFi should allow all transports
      expect(config.iceTransportPolicy).toBe('all');
      expect(config.iceCandidatePoolSize).toBeGreaterThan(4);
    });

    test('should handle unknown network types', () => {
      const config = getOptimizedICEConfiguration('unknown');
      
      // Unknown should use conservative settings
      expect(config.iceTransportPolicy).toBe('all');
      expect(config.iceCandidatePoolSize).toBeLessThanOrEqual(6);
    });
  });

  describe('Configuration Summary', () => {
    test('should provide configuration summary', () => {
      const manager = new TURNFirstICEManager();
      const summary = manager.getConfigurationSummary();
      
      expect(summary).toBeDefined();
      expect(typeof summary.turnServers).toBe('number');
      expect(typeof summary.stunServers).toBe('number');
      expect(typeof summary.cachedConfigs).toBe('number');
      expect(summary.defaultNetworkPolicy).toBe('TURN-first with parallel STUN/TURN gathering');
      expect(summary.cacheStats).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle missing TURN credentials gracefully', () => {
      // Remove TURN credentials
      process.env.NEXT_PUBLIC_METERED_TURN_USERNAME = '';
      process.env.NEXT_PUBLIC_METERED_TURN_CREDENTIAL = '';
      
      const manager = new TURNFirstICEManager();
      const config = manager.generateOptimizedConfig('wifi');
      
      // Should still generate configuration with STUN servers
      expect(config).toBeDefined();
      expect(config.iceServers.length).toBeGreaterThan(0);
      
      // Should have STUN servers even without TURN
      const stunServers = config.iceServers.filter(server => 
        (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('stun')) : server.urls.startsWith('stun'))
      );
      expect(stunServers.length).toBeGreaterThan(0);
    });
  });

  describe('Integration with Global Manager', () => {
    test('should use global manager instance', () => {
      const config1 = turnFirstICEManager.generateOptimizedConfig('wifi');
      const config2 = getOptimizedICEConfiguration('wifi');
      
      // Should produce equivalent configurations
      expect(config1.iceServers.length).toBe(config2.iceServers.length);
      expect(config1.iceTransportPolicy).toBe(config2.iceTransportPolicy);
    });

    test('should update global configuration success', () => {
      // Generate configuration first
      getOptimizedICEConfiguration('wifi');
      
      // Update success rate
      updateConfigurationSuccess('wifi', true);
      updateConfigurationSuccess('wifi', false);
      
      // Should not throw errors
      expect(true).toBe(true);
    });
  });
});

describe('TURN-First Strategy Requirements Validation', () => {
  test('Requirements 1.1: Should configure at least two TURN servers', async () => {
    const validation = await validateTurnServerSetup();
    
    // Should have multiple TURN servers configured
    expect(validation.totalServers).toBeGreaterThanOrEqual(2);
  });

  test('Requirements 1.2, 1.5: Should include TURN servers in parallel with STUN', () => {
    const config = getOptimizedICEConfiguration('wifi');
    
    const turnServers = config.iceServers.filter(server => 
      (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('turn')) : server.urls.startsWith('turn'))
    );
    const stunServers = config.iceServers.filter(server => 
      (Array.isArray(server.urls) ? server.urls.some(url => url.startsWith('stun')) : server.urls.startsWith('stun'))
    );
    
    // Both TURN and STUN should be present (parallel gathering)
    expect(turnServers.length).toBeGreaterThan(0);
    expect(stunServers.length).toBeGreaterThan(0);
  });

  test('Requirements 1.3: Should optimize ICE candidate pool size', () => {
    const mobileConfig = getOptimizedICEConfiguration('mobile');
    const wifiConfig = getOptimizedICEConfiguration('wifi');
    
    // Pool sizes should be optimized for network type
    expect(mobileConfig.iceCandidatePoolSize).toBeLessThanOrEqual(4);
    expect(wifiConfig.iceCandidatePoolSize).toBeGreaterThan(mobileConfig.iceCandidatePoolSize);
  });

  test('Requirements 1.4: Should configure ICE transport policies for mobile networks', () => {
    const mobileConfig = getOptimizedICEConfiguration('mobile');
    const wifiConfig = getOptimizedICEConfiguration('wifi');
    
    // Mobile should prefer relay, WiFi should allow all
    expect(mobileConfig.iceTransportPolicy).toBe('relay');
    expect(wifiConfig.iceTransportPolicy).toBe('all');
  });
});