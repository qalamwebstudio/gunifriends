/**
 * Performance Dashboard Component
 * 
 * Displays real-time WebRTC connection performance metrics, alerts, and network adaptations.
 * Provides debugging and monitoring interface for connection performance optimization.
 * 
 * Requirements: 10.4, 10.5 - Performance alerts and reporting interface
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getPerformanceReport,
  usePerformanceMonitoring,
  type PerformanceAlert,
  type PerformanceStats
} from '../lib/webrtc-performance-integration';
import {
  onPerformanceAlert,
  onMetricsUpdate,
  getCurrentRealTimeMetrics,
  getRealTimeMetricsHistory,
  type RealTimeMetrics
} from '../lib/real-time-performance-monitor';

interface PerformanceDashboardProps {
  isVisible?: boolean;
  onClose?: () => void;
  sessionId?: string;
}

export default function PerformanceDashboard({ 
  isVisible = false, 
  onClose,
  sessionId 
}: PerformanceDashboardProps) {
  const [performanceData, setPerformanceData] = useState<ReturnType<typeof getPerformanceReport> | null>(null);
  const [realTimeMetrics, setRealTimeMetrics] = useState<RealTimeMetrics | null>(null);
  const [realtimeAlerts, setRealtimeAlerts] = useState<PerformanceAlert[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'realtime' | 'alerts' | 'network' | 'detailed'>('overview');

  const { getStats, getAlerts, getAdaptations } = usePerformanceMonitoring();

  // Setup real-time monitoring callbacks
  useEffect(() => {
    const handleRealTimeAlert = (alert: PerformanceAlert) => {
      setRealtimeAlerts(prev => [alert, ...prev.slice(0, 9)]); // Keep last 10 alerts
    };

    const handleMetricsUpdate = (metrics: RealTimeMetrics) => {
      setRealTimeMetrics(metrics);
    };

    onPerformanceAlert(handleRealTimeAlert);
    onMetricsUpdate(handleMetricsUpdate);

    // Initial real-time metrics load
    const currentMetrics = getCurrentRealTimeMetrics();
    if (currentMetrics) {
      setRealTimeMetrics(currentMetrics);
    }

    return () => {
      // Cleanup would go here if we had unsubscribe functions
    };
  }, []);

  // Refresh performance data
  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      const report = getPerformanceReport();
      setPerformanceData(report);
    } catch (error) {
      console.error('Failed to refresh performance data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-refresh effect
  useEffect(() => {
    if (isVisible && autoRefresh) {
      refreshData();
      const interval = setInterval(refreshData, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [isVisible, autoRefresh, refreshData]);

  // Initial load
  useEffect(() => {
    if (isVisible) {
      refreshData();
    }
  }, [isVisible, refreshData]);

  if (!isVisible || !performanceData) {
    return null;
  }

  const { summary, recentAlerts, networkAdaptations, recommendations } = performanceData;

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;

  const getAlertIcon = (severity: 'warning' | 'error' | 'critical') => {
    switch (severity) {
      case 'warning': return '⚠️';
      case 'error': return '❌';
      case 'critical': return '🚨';
    }
  };

  const getQualityColor = (value: number, target: number, reverse: boolean = false) => {
    const ratio = reverse ? target / value : value / target;
    if (ratio >= 0.9) return 'text-green-600';
    if (ratio >= 0.7) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">WebRTC Performance Dashboard</h2>
            {sessionId && (
              <p className="text-sm text-gray-600">Session: {sessionId}</p>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-600">Auto-refresh</span>
            </label>
            <button
              onClick={refreshData}
              disabled={isLoading}
              className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b">
          <nav className="flex space-x-8 px-6">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'realtime', label: 'Real-time' },
              { id: 'alerts', label: `Alerts (${recentAlerts.length + realtimeAlerts.length})` },
              { id: 'network', label: 'Network' },
              { id: 'detailed', label: 'Detailed' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTab(tab.id as any)}
                className={`py-3 px-1 border-b-2 font-medium text-sm ${
                  selectedTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {selectedTab === 'overview' && (
            <div className="space-y-6">
              {/* Key Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-500">Total Connections</h3>
                  <p className="text-2xl font-bold text-gray-900">{summary.totalConnections}</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-500">Success Rate</h3>
                  <p className={`text-2xl font-bold ${getQualityColor(summary.successRate, 0.9)}`}>
                    {formatPercentage(summary.successRate)}
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-500">Avg Connection Time</h3>
                  <p className={`text-2xl font-bold ${getQualityColor(5000, summary.averageConnectionTime, true)}`}>
                    {formatTime(summary.averageConnectionTime)}
                  </p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-500">Target Success Rate</h3>
                  <p className={`text-2xl font-bold ${getQualityColor(summary.targetSuccessRate, 0.9)}`}>
                    {formatPercentage(summary.targetSuccessRate)}
                  </p>
                </div>
              </div>

              {/* Performance Targets */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="text-lg font-medium text-gray-900 mb-3">Performance Targets</h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Connections under 5 seconds:</span>
                    <span className={`font-medium ${getQualityColor(summary.targetSuccessRate, 0.9)}`}>
                      {summary.connectionsUnder5Seconds} / {summary.totalConnections} ({formatPercentage(summary.targetSuccessRate)})
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">95th percentile time:</span>
                    <span className={`font-medium ${getQualityColor(5000, summary.percentile95ConnectionTime, true)}`}>
                      {formatTime(summary.percentile95ConnectionTime)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Median connection time:</span>
                    <span className={`font-medium ${getQualityColor(5000, summary.medianConnectionTime, true)}`}>
                      {formatTime(summary.medianConnectionTime)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Recent Performance */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="text-lg font-medium text-gray-900 mb-3">Last 24 Hours</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <span className="text-sm text-gray-600">Connections:</span>
                    <p className="font-medium">{summary.last24Hours.connections}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Success Rate:</span>
                    <p className={`font-medium ${getQualityColor(summary.last24Hours.successRate, 0.9)}`}>
                      {formatPercentage(summary.last24Hours.successRate)}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Avg Time:</span>
                    <p className={`font-medium ${getQualityColor(5000, summary.last24Hours.averageTime, true)}`}>
                      {formatTime(summary.last24Hours.averageTime)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Recommendations */}
              {recommendations.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                  <h3 className="text-lg font-medium text-yellow-800 mb-3">Recommendations</h3>
                  <ul className="space-y-1">
                    {recommendations.slice(0, 5).map((rec, index) => (
                      <li key={index} className="text-sm text-yellow-700">
                        • {rec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {selectedTab === 'realtime' && (
            <div className="space-y-6">
              {/* Real-time Connection Status */}
              {realTimeMetrics && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Live Connection Status</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className={`text-3xl font-bold ${
                        realTimeMetrics.connectionQuality === 'excellent' ? 'text-green-600' :
                        realTimeMetrics.connectionQuality === 'good' ? 'text-blue-600' :
                        realTimeMetrics.connectionQuality === 'fair' ? 'text-yellow-600' :
                        realTimeMetrics.connectionQuality === 'poor' ? 'text-orange-600' :
                        'text-red-600'
                      }`}>
                        {realTimeMetrics.connectionQuality.toUpperCase()}
                      </div>
                      <p className="text-sm text-gray-600">Connection Quality</p>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-900">
                        {realTimeMetrics.currentLatency.toFixed(0)}ms
                      </div>
                      <p className="text-sm text-gray-600">Latency</p>
                      <div className={`text-xs ${
                        realTimeMetrics.trends.latencyTrend === 'improving' ? 'text-green-600' :
                        realTimeMetrics.trends.latencyTrend === 'degrading' ? 'text-red-600' :
                        'text-gray-600'
                      }`}>
                        {realTimeMetrics.trends.latencyTrend === 'improving' ? '↓ Improving' :
                         realTimeMetrics.trends.latencyTrend === 'degrading' ? '↑ Degrading' :
                         '→ Stable'}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-900">
                        {(realTimeMetrics.currentPacketLoss * 100).toFixed(1)}%
                      </div>
                      <p className="text-sm text-gray-600">Packet Loss</p>
                      <div className={`text-xs ${
                        realTimeMetrics.trends.packetLossTrend === 'improving' ? 'text-green-600' :
                        realTimeMetrics.trends.packetLossTrend === 'degrading' ? 'text-red-600' :
                        'text-gray-600'
                      }`}>
                        {realTimeMetrics.trends.packetLossTrend === 'improving' ? '↓ Improving' :
                         realTimeMetrics.trends.packetLossTrend === 'degrading' ? '↑ Degrading' :
                         '→ Stable'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Jitter:</span>
                      <span className="ml-2 font-medium">{realTimeMetrics.currentJitter.toFixed(1)}ms</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Bandwidth:</span>
                      <span className="ml-2 font-medium">{(realTimeMetrics.bandwidth / 1000).toFixed(0)} kbps</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Connection:</span>
                      <span className="ml-2 font-medium">{realTimeMetrics.connectionState}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">ICE:</span>
                      <span className="ml-2 font-medium">{realTimeMetrics.iceConnectionState}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Real-time Alerts */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">Live Alerts</h3>
                {realtimeAlerts.length === 0 ? (
                  <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <div className="flex items-center">
                      <span className="text-green-600 text-lg mr-2">✓</span>
                      <span className="text-green-800">No active performance issues</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {realtimeAlerts.slice(0, 5).map((alert, index) => (
                      <div
                        key={index}
                        className={`p-3 rounded-lg border-l-4 ${
                          alert.severity === 'critical'
                            ? 'bg-red-50 border-red-400'
                            : alert.severity === 'error'
                            ? 'bg-orange-50 border-orange-400'
                            : 'bg-yellow-50 border-yellow-400'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-2">
                            <span className="text-lg">
                              {alert.severity === 'critical' ? '🚨' : 
                               alert.severity === 'error' ? '❌' : '⚠️'}
                            </span>
                            <div>
                              <p className="font-medium text-gray-900">{alert.message}</p>
                              <p className="text-xs text-gray-600 mt-1">
                                {new Date(alert.timestamp).toLocaleTimeString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Performance Metrics History Chart */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">Performance Trends</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-center text-gray-600">
                    <p>Real-time performance chart would be displayed here</p>
                    <p className="text-sm mt-1">
                      {getRealTimeMetricsHistory().length} data points collected
                    </p>
                  </div>
                </div>
              </div>

              {/* Connection Details */}
              {realTimeMetrics && (
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-3">Connection Details</h3>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Current Status</h4>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span>Quality:</span>
                            <span className={`font-medium ${
                              realTimeMetrics.connectionQuality === 'excellent' ? 'text-green-600' :
                              realTimeMetrics.connectionQuality === 'good' ? 'text-blue-600' :
                              realTimeMetrics.connectionQuality === 'fair' ? 'text-yellow-600' :
                              realTimeMetrics.connectionQuality === 'poor' ? 'text-orange-600' :
                              'text-red-600'
                            }`}>
                              {realTimeMetrics.connectionQuality}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Overall Trend:</span>
                            <span className={`font-medium ${
                              realTimeMetrics.trends.overallTrend === 'improving' ? 'text-green-600' :
                              realTimeMetrics.trends.overallTrend === 'degrading' ? 'text-red-600' :
                              'text-gray-600'
                            }`}>
                              {realTimeMetrics.trends.overallTrend}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-700 mb-2">Last Updated</h4>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span>Timestamp:</span>
                            <span className="font-medium">
                              {new Date(realTimeMetrics.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Data Age:</span>
                            <span className="font-medium">
                              {Math.round((Date.now() - realTimeMetrics.timestamp) / 1000)}s ago
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {!realTimeMetrics && (
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <div className="flex items-center">
                    <span className="text-yellow-600 text-lg mr-2">⚠️</span>
                    <div>
                      <p className="text-yellow-800 font-medium">Real-time monitoring not active</p>
                      <p className="text-yellow-700 text-sm mt-1">
                        Real-time monitoring will start automatically when a WebRTC connection is established.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedTab === 'alerts' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Performance Alerts</h3>
              
              {/* Real-time Alerts Section */}
              {realtimeAlerts.length > 0 && (
                <div>
                  <h4 className="text-md font-medium text-gray-800 mb-2">Live Alerts</h4>
                  <div className="space-y-3">
                    {realtimeAlerts.map((alert, index) => (
                      <div
                        key={`realtime-${index}`}
                        className={`p-4 rounded-lg border-l-4 ${
                          alert.severity === 'critical'
                            ? 'bg-red-50 border-red-400'
                            : alert.severity === 'error'
                            ? 'bg-orange-50 border-orange-400'
                            : 'bg-yellow-50 border-yellow-400'
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          <span className="text-lg">{getAlertIcon(alert.severity)}</span>
                          <div className="flex-1">
                            <div className="flex justify-between items-start">
                              <h4 className="font-medium text-gray-900">
                                {alert.type.replace(/-/g, ' ').toUpperCase()} (Live)
                              </h4>
                              <span className="text-xs text-gray-500">
                                {new Date(alert.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 mt-1">{alert.message}</p>
                            {alert.recommendations.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs font-medium text-gray-600">Recommendations:</p>
                                <ul className="text-xs text-gray-600 mt-1 space-y-1">
                                  {alert.recommendations.map((rec, recIndex) => (
                                    <li key={recIndex} className="flex items-start">
                                      <span className="mr-1">•</span>
                                      <span>{rec}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Historical Alerts Section */}
              <div>
                <h4 className="text-md font-medium text-gray-800 mb-2">Recent Historical Alerts</h4>
                {recentAlerts.length === 0 ? (
                  <p className="text-gray-500">No recent historical alerts</p>
                ) : (
                  <div className="space-y-3">
                    {recentAlerts.map((alert, index) => (
                      <div
                        key={`historical-${index}`}
                        className={`p-4 rounded-lg border-l-4 ${
                          alert.severity === 'critical'
                            ? 'bg-red-50 border-red-400'
                            : alert.severity === 'error'
                            ? 'bg-orange-50 border-orange-400'
                            : 'bg-yellow-50 border-yellow-400'
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          <span className="text-lg">{getAlertIcon(alert.severity)}</span>
                          <div className="flex-1">
                            <div className="flex justify-between items-start">
                              <h4 className="font-medium text-gray-900">
                                {alert.type.replace(/-/g, ' ').toUpperCase()}
                              </h4>
                              <span className="text-xs text-gray-500">
                                {new Date(alert.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 mt-1">{alert.message}</p>
                            {alert.recommendations.length > 0 && (
                              <div className="mt-2">
                                <p className="text-xs font-medium text-gray-600">Recommendations:</p>
                                <ul className="text-xs text-gray-600 mt-1 space-y-1">
                                  {alert.recommendations.map((rec, recIndex) => (
                                    <li key={recIndex}>• {rec}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedTab === 'network' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">Network Classification</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-gray-600">Network Type:</span>
                      <p className="font-medium capitalize">{networkAdaptations.currentNetwork.type}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">Confidence:</span>
                      <p className="font-medium">{formatPercentage(networkAdaptations.currentNetwork.confidence)}</p>
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <span className="text-sm text-gray-600">Indicators:</span>
                    <ul className="text-sm text-gray-700 mt-1 space-y-1">
                      {networkAdaptations.currentNetwork.indicators.map((indicator, index) => (
                        <li key={index}>• {indicator}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">Configuration Suggestions</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-gray-600">ICE Transport Policy:</span>
                      <p className="font-medium">{networkAdaptations.configurationSuggestions.iceTransportPolicy}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">ICE Candidate Pool Size:</span>
                      <p className="font-medium">{networkAdaptations.configurationSuggestions.iceCandidatePoolSize}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">TURN Fallback Timeout:</span>
                      <p className="font-medium">{formatTime(networkAdaptations.configurationSuggestions.turnFallbackTimeout)}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">ICE Gathering Timeout:</span>
                      <p className="font-medium">{formatTime(networkAdaptations.configurationSuggestions.iceGatheringTimeout)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">Performance by Network Type</h3>
                <div className="space-y-3">
                  {Object.entries(summary.byNetworkType).map(([networkType, stats]) => (
                    <div key={networkType} className="bg-gray-50 p-4 rounded-lg">
                      <h4 className="font-medium capitalize text-gray-900">{networkType}</h4>
                      <div className="grid grid-cols-3 gap-4 mt-2">
                        <div>
                          <span className="text-sm text-gray-600">Connections:</span>
                          <p className="font-medium">{stats.connections}</p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-600">Success Rate:</span>
                          <p className={`font-medium ${getQualityColor(stats.successRate, 0.9)}`}>
                            {formatPercentage(stats.successRate)}
                          </p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-600">Avg Time:</span>
                          <p className={`font-medium ${getQualityColor(5000, stats.averageTime, true)}`}>
                            {formatTime(stats.averageTime)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {selectedTab === 'detailed' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">Performance by Candidate Type</h3>
                <div className="space-y-3">
                  {Object.entries(summary.byCandidateType).map(([candidateType, stats]) => (
                    <div key={candidateType} className="bg-gray-50 p-4 rounded-lg">
                      <h4 className="font-medium text-gray-900">{candidateType}</h4>
                      <div className="grid grid-cols-3 gap-4 mt-2">
                        <div>
                          <span className="text-sm text-gray-600">Connections:</span>
                          <p className="font-medium">{stats.connections}</p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-600">Success Rate:</span>
                          <p className={`font-medium ${getQualityColor(stats.successRate, 0.9)}`}>
                            {formatPercentage(stats.successRate)}
                          </p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-600">Avg Time:</span>
                          <p className={`font-medium ${getQualityColor(5000, stats.averageTime, true)}`}>
                            {formatTime(stats.averageTime)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-3">Alert Summary</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm text-gray-600">Total Alerts:</span>
                      <p className="font-medium">{summary.alerts.total}</p>
                    </div>
                    <div>
                      <span className="text-sm text-gray-600">By Severity:</span>
                      <div className="text-sm mt-1">
                        {Object.entries(summary.alerts.bySeverity).map(([severity, count]) => (
                          <div key={severity} className="flex justify-between">
                            <span className="capitalize">{severity}:</span>
                            <span>{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <span className="text-sm text-gray-600">By Type:</span>
                    <div className="text-sm mt-1 space-y-1">
                      {Object.entries(summary.alerts.byType).map(([type, count]) => (
                        <div key={type} className="flex justify-between">
                          <span className="capitalize">{type.replace(/-/g, ' ')}:</span>
                          <span>{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}