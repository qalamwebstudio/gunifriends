/**
 * ICE Configuration Caching and Optimization Tests
 * 
 * Tests for task 8: Implement ICE Configuration Caching and Optimization
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import { 
  TURNFirstICEManager,
  turnFirstICEManager,
  getOptimizedICEConfiguration,
  updateConfigurationSuccess,
  setNetworkConfigurationPreference,
  getNetworkConfigurationPreference,
  clearConfigurationCaches,
  getConfigurationCacheStats,
  getTurnCredentialStatistics
} from './turn-first-ice-manager';

describe('ICE Configuration Caching and Optimization', () => {
  let manager: TURNFirstICEManager;

  beforeEach(() => {
    // Create a fresh manager instance for each test
    manager = new TURNFirstICEManager();
  });

  afterEach(() => {
    // Clean up after each test
    clearConfigurationCaches();
  });

  describe('Session-based Configuration Caching (Requirement 8.1)', () => {
    test('should cache ICE configurations per network type', () => {
      // Generate configuration for mobile network
      const mobileConfig1 = manager.generateOptimizedConfig('mobile');
      const mobileConfig2 = manager.generateOptimizedConfig('mobile');

      // Second call should return cached configuration
      expect(mobileConfig2).toEqual(mobileConfig1);

      // Verify cache statistics
      const stats = manager.getCacheStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.entriesByNetwork['mobile']).toBeDefined();
      expect(stats.entriesByNetwork['mobile'].connectionCount).toBe(2);
    });

    test('should maintain separate caches for different network types', () => {
      const mobileConfig = manager.generateOptimizedConfig('mobile');
      const wifiConfig = manager.generateOptimizedConfig('wifi');

      // Configurations should be different due to network-specific optimizations
      expect(mobileConfig.iceCandidatePoolSize).not.toBe(wifiConfig.iceCandidatePoolSize);

      // Verify separate cache entries
      const stats = manager.getCacheStats();
      expect(stats.totalEntries).toBe(2);
      expect(stats.entriesByNetwork['mobile']).toBeDefined();
      expect(stats.entriesByNetwork['wifi']).toBeDefined();
    });

    test('should track cache usage and success rates', () => {
      const networkType = 'wifi';
      
      // Generate initial configuration
      manager.generateOptimizedConfig(networkType);
      
      // Update success rate with connection timing
      manager.updateCacheSuccessRate(networkType, true, 3500);
      manager.updateCacheSuccessRate(networkType, true, 4200);
      manager.updateCacheSuccessRate(networkType, false);

      const stats = manager.getCacheStats();
      const wifiStats = stats.entriesByNetwork[networkType];
      
      expect(wifiStats.successRate).toBeGreaterThan(0);
      expect(wifiStats.successRate).toBeLessThan(1); // Should be reduced due to one failure
      expect(wifiStats.averageConnectionTime).toBeGreaterThan(0);
    });

    test('should expire old cache entries', () => {
      // Generate configuration
      manager.generateOptimizedConfig('mobile');
      
      // Verify cache exists
      let stats = manager.getCacheStats();
      expect(stats.totalEntries).toBe(1);

      // Mock time passage by directly manipulating cache timestamp
      const cache = manager['configCache'].get('mobile');
      if (cache) {
        cache.timestamp = Date.now() - (31 * 60 * 1000); // 31 minutes ago
      }

      // Cleanup should remove expired entry
      manager.cleanupCache();
      
      stats = manager.getCacheStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('TURN Credential Reuse (Requirement 8.2)', () => {
    test('should cache and reuse TURN credentials', () => {
      // Generate configuration for first network type
      const config1 = manager.generateOptimizedConfig('mobile');
      
      // Generate configuration for different network type to trigger credential reuse
      const config2 = manager.generateOptimizedConfig('wifi');

      // Verify credential statistics
      const credentialStats = manager.getTurnCredentialStats();
      expect(credentialStats.totalCredentials).toBeGreaterThan(0);
      
      // Check if any credentials have been reused
      const hasReusedCredentials = Object.values(credentialStats.credentialsByServer)
        .some(cred => cred.reuseCount > 0);
      expect(hasReusedCredentials).toBe(true);
    });

    test('should track credential reuse count', () => {
      // Generate multiple configurations to trigger reuse
      manager.generateOptimizedConfig('mobile');
      manager.generateOptimizedConfig('wifi');
      manager.generateOptimizedConfig('mobile'); // Should reuse credentials

      const credentialStats = manager.getTurnCredentialStats();
      expect(credentialStats.totalReuseCount).toBeGreaterThan(0);
    });

    test('should expire old credentials', () => {
      // Generate configuration to create credentials
      manager.generateOptimizedConfig('mobile');
      
      // Verify credentials exist
      let credentialStats = manager.getTurnCredentialStats();
      expect(credentialStats.totalCredentials).toBeGreaterThan(0);

      // Mock credential expiration
      const credentialCache = manager['turnCredentialCache'];
      for (const [serverId, credential] of credentialCache.entries()) {
        credential.expiresAt = Date.now() - 1000; // Expired 1 second ago
      }

      // Cleanup should remove expired credentials
      manager.cleanupCache();
      
      credentialStats = manager.getTurnCredentialStats();
      expect(credentialStats.validCredentials).toBe(0);
      expect(credentialStats.expiredCredentials).toBe(credentialStats.totalCredentials);
    });
  });

  describe('Optimized ICE Candidate Pool Size (Requirement 8.3)', () => {
    test('should use different pool sizes for different network types', () => {
      const mobileConfig = manager.generateOptimizedConfig('mobile');
      const wifiConfig = manager.generateOptimizedConfig('wifi');

      // Mobile should have smaller pool size for battery optimization
      expect(mobileConfig.iceCandidatePoolSize).toBeLessThanOrEqual(wifiConfig.iceCandidatePoolSize);
      
      // Verify specific optimized values
      expect(mobileConfig.iceCandidatePoolSize).toBe(3); // Mobile optimized
      expect(wifiConfig.iceCandidatePoolSize).toBe(5); // WiFi optimized
    });

    test('should use conservative pool size for unknown networks', () => {
      const unknownConfig = manager.generateOptimizedConfig('unknown');
      
      // Unknown networks should use conservative pool size
      expect(unknownConfig.iceCandidatePoolSize).toBe(4);
    });
  });

  describe('Network-specific Configuration Preferences (Requirement 8.4)', () => {
    test('should apply network-specific preferences', () => {
      const mobileConfig = manager.generateOptimizedConfig('mobile');
      const wifiConfig = manager.generateOptimizedConfig('wifi');

      // Mobile should prefer relay for CGNAT traversal
      expect(mobileConfig.iceTransportPolicy).toBe('relay');
      
      // WiFi should use all transport types
      expect(wifiConfig.iceTransportPolicy).toBe('all');
    });

    test('should allow custom network preferences', () => {
      const customPreferences = {
        iceCandidatePoolSize: 8,
        iceTransportPolicy: 'relay' as const,
        bundlePolicy: 'max-compat' as const
      };

      // Set custom preferences
      manager.setNetworkPreference('custom', customPreferences);
      
      // Verify preferences are stored
      const storedPreferences = manager.getNetworkPreference('custom');
      expect(storedPreferences).toEqual(customPreferences);

      // Generate configuration with custom preferences
      const customConfig = manager.generateOptimizedConfig('custom' as any);
      expect(customConfig.iceCandidatePoolSize).toBe(8);
      expect(customConfig.iceTransportPolicy).toBe('relay');
      expect(customConfig.bundlePolicy).toBe('max-compat');
    });

    test('should invalidate cache when preferences change', () => {
      // Generate initial configuration
      manager.generateOptimizedConfig('wifi');
      
      // Verify cache exists
      let stats = manager.getCacheStats();
      expect(stats.totalEntries).toBe(1);

      // Change preferences
      manager.setNetworkPreference('wifi', { iceCandidatePoolSize: 10 });
      
      // Cache should be invalidated
      stats = manager.getCacheStats();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('Configuration Effectiveness Tracking (Requirement 8.5)', () => {
    test('should track configuration success rates', () => {
      const networkType = 'wifi';
      
      // Generate configuration
      manager.generateOptimizedConfig(networkType);
      
      // Report successful connections
      manager.updateCacheSuccessRate(networkType, true, 2500);
      manager.updateCacheSuccessRate(networkType, true, 3200);
      
      const stats = manager.getCacheStats();
      const wifiStats = stats.entriesByNetwork[networkType];
      
      expect(wifiStats.successRate).toBeCloseTo(1.0, 1);
      expect(wifiStats.averageConnectionTime).toBeGreaterThan(0);
    });

    test('should remove configurations with low success rates', () => {
      const networkType = 'mobile';
      
      // Generate configuration
      manager.generateOptimizedConfig(networkType);
      
      // Report multiple failures to drop success rate
      for (let i = 0; i < 10; i++) {
        manager.updateCacheSuccessRate(networkType, false);
      }
      
      // Configuration should be removed from cache
      const stats = manager.getCacheStats();
      expect(stats.entriesByNetwork[networkType]).toBeUndefined();
    });

    test('should provide comprehensive statistics', () => {
      // Generate configurations for multiple networks
      manager.generateOptimizedConfig('mobile');
      manager.generateOptimizedConfig('wifi');
      
      // Update with some connection data
      manager.updateCacheSuccessRate('mobile', true, 4000);
      manager.updateCacheSuccessRate('wifi', true, 3000);

      const summary = manager.getConfigurationSummary();
      
      expect(summary.cachedConfigs).toBe(2);
      expect(summary.optimizations.sessionBasedCaching).toBe(true);
      expect(summary.optimizations.networkSpecificPreferences).toBe(true);
      expect(summary.optimizations.optimizedPoolSizes).toBe(true);
      expect(summary.sessionId).toBeDefined();
    });
  });

  describe('Integration with Existing System', () => {
    test('should work with convenience functions', () => {
      // Test convenience functions
      const config = getOptimizedICEConfiguration('mobile');
      expect(config).toBeDefined();
      expect(config.iceCandidatePoolSize).toBe(3);

      // Test success rate update
      updateConfigurationSuccess('mobile', true, 3500);
      
      // Test network preferences
      setNetworkConfigurationPreference('test', { iceCandidatePoolSize: 7 });
      const preference = getNetworkConfigurationPreference('test');
      expect(preference?.iceCandidatePoolSize).toBe(7);

      // Test statistics
      const stats = getConfigurationCacheStats();
      expect(stats.totalEntries).toBeGreaterThan(0);
    });

    test('should maintain backward compatibility', () => {
      // Existing code should continue to work
      const config = turnFirstICEManager.generateOptimizedConfig('wifi');
      expect(config).toBeDefined();
      expect(config.iceServers.length).toBeGreaterThan(0);
    });
  });
});