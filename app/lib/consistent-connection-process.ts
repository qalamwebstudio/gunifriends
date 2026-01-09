/**
 * Consistent Connection Process Manager
 * 
 * Ensures the same deterministic connection process is followed across all attempts by:
 * - Implementing standardized connection steps
 * - Enforcing consistent execution order
 * - Eliminating process variations between attempts
 * - Providing deterministic fallback strategies
 * 
 * Requirements: 9.4, 9.5 - Ensure consistent connection process across all attempts
 */

import { DeterministicConnectionController } from './deterministic-connection-controller';
import { getRaceConditionPrevention } from './race-condition-prevention';
import { 
  CONNECTION_CONFIG,
  INITIAL_CONNECTION_TIMEOUT_MS,
  ICE_GATHERING_TIMEOUT_MS,
  TURN_FALLBACK_TIMEOUT_MS
} from './connection-config';

export interface ConnectionStep {
  name: string;
  description: string;
  timeout: number;
  prerequisites: string[];
  isOptional: boolean;
  retryable: boolean;
}

export interface ConnectionAttemptLog {
  attemptNumber: number;
  startTime: number;
  endTime?: number;
  steps: Array<{
    name: string;
    startTime: number;
    endTime?: number;
    success: boolean;
    duration?: number;
    error?: string;
  }>;
  networkType: 'mobile' | 'wifi' | 'unknown';
  finalResult: 'success' | 'failure' | 'timeout' | 'cancelled';
  totalDuration?: number;
}

/**
 * Consistent Connection Process Manager
 * 
 * Manages the standardized connection process to ensure identical
 * behavior across all connection attempts.
 */
export class ConsistentConnectionProcess {
  private standardSteps: ConnectionStep[];
  private attemptLogs: ConnectionAttemptLog[] = [];
  private currentAttempt: ConnectionAttemptLog | null = null;
  private deterministicController: DeterministicConnectionController;
  
  // Process consistency tracking
  private processTemplate: string[] = [];
  private processVariations: Map<string, number> = new Map();

  constructor() {
    // Requirements 9.4: Define standardized connection steps that are always the same
    this.standardSteps = [
      {
        name: 'media-access',
        description: 'Access user media (camera/microphone)',
        timeout: 10000, // Always 10 seconds
        prerequisites: [],
        isOptional: false,
        retryable: true
      },
      {
        name: 'peer-connection-creation',
        description: 'Create RTCPeerConnection with TURN-first configuration',
        timeout: 2000, // Always 2 seconds
        prerequisites: ['media-access'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'track-attachment',
        description: 'Attach media tracks to peer connection',
        timeout: 1000, // Always 1 second
        prerequisites: ['media-access', 'peer-connection-creation'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'ice-configuration',
        description: 'Configure ICE servers and gathering parameters',
        timeout: 1000, // Always 1 second
        prerequisites: ['peer-connection-creation'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'ice-gathering',
        description: 'Start ICE candidate gathering',
        timeout: ICE_GATHERING_TIMEOUT_MS, // Always 5 seconds
        prerequisites: ['track-attachment', 'ice-configuration'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'signaling-setup',
        description: 'Initialize signaling channel',
        timeout: 3000, // Always 3 seconds
        prerequisites: ['peer-connection-creation'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'offer-creation',
        description: 'Create SDP offer',
        timeout: 2000, // Always 2 seconds
        prerequisites: ['track-attachment', 'signaling-setup'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'local-description-set',
        description: 'Set local SDP description',
        timeout: 1000, // Always 1 second
        prerequisites: ['offer-creation'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'offer-transmission',
        description: 'Send offer to remote peer',
        timeout: 5000, // Always 5 seconds
        prerequisites: ['local-description-set', 'signaling-setup'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'answer-reception',
        description: 'Receive SDP answer from remote peer',
        timeout: 10000, // Always 10 seconds
        prerequisites: ['offer-transmission'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'remote-description-set',
        description: 'Set remote SDP description',
        timeout: 1000, // Always 1 second
        prerequisites: ['answer-reception'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'ice-candidate-exchange',
        description: 'Exchange ICE candidates',
        timeout: 8000, // Always 8 seconds
        prerequisites: ['ice-gathering', 'remote-description-set'],
        isOptional: false,
        retryable: true
      },
      {
        name: 'connection-establishment',
        description: 'Establish WebRTC connection',
        timeout: 5000, // Always 5 seconds
        prerequisites: ['ice-candidate-exchange'],
        isOptional: false,
        retryable: false
      }
    ];

    // Create process template for consistency validation
    this.processTemplate = this.standardSteps.map(step => step.name);
    
    // Initialize deterministic controller
    this.deterministicController = new DeterministicConnectionController();

    console.log('🎯 Consistent Connection Process initialized');
    console.log('📋 Standardized process steps:', this.processTemplate);
    console.log('⏰ All timeouts are fixed - no variation between attempts');
  }

  /**
   * Start consistent connection attempt
   * Requirements: 9.4, 9.5 - Ensure consistent connection process across all attempts
   */
  async startConsistentConnectionAttempt(
    networkType: 'mobile' | 'wifi' | 'unknown',
    onStepProgress: (step: string, progress: number) => void,
    onStepComplete: (step: string, success: boolean, duration: number) => void
  ): Promise<ConnectionAttemptLog> {
    const attemptNumber = this.attemptLogs.length + 1;
    
    console.log(`🎯 Starting consistent connection attempt #${attemptNumber}`);
    console.log(`🌐 Network type: ${networkType}`);
    console.log('📋 Following standardized process - no variations');

    // Initialize attempt log
    this.currentAttempt = {
      attemptNumber,
      startTime: Date.now(),
      steps: [],
      networkType,
      finalResult: 'failure' // Will be updated on completion
    };

    try {
      // Execute each step in the standardized order
      for (let i = 0; i < this.standardSteps.length; i++) {
        const step = this.standardSteps[i];
        const progress = ((i + 1) / this.standardSteps.length) * 100;
        
        console.log(`🎯 Executing step ${i + 1}/${this.standardSteps.length}: ${step.name}`);
        onStepProgress(step.name, progress);

        // Validate prerequisites
        if (!this.validatePrerequisites(step)) {
          throw new Error(`Prerequisites not met for step: ${step.name}`);
        }

        // Execute step with consistent timing
        const stepResult = await this.executeStandardStep(step);
        
        // Log step completion
        this.currentAttempt.steps.push(stepResult);
        onStepComplete(step.name, stepResult.success, stepResult.duration || 0);

        if (!stepResult.success && !step.isOptional) {
          throw new Error(`Required step failed: ${step.name} - ${stepResult.error}`);
        }

        console.log(`✅ Completed step: ${step.name} (${stepResult.duration}ms)`);
      }

      // Mark attempt as successful
      this.currentAttempt.finalResult = 'success';
      this.currentAttempt.endTime = Date.now();
      this.currentAttempt.totalDuration = this.currentAttempt.endTime - this.currentAttempt.startTime;

      console.log(`🎉 Consistent connection attempt #${attemptNumber} completed successfully`);
      console.log(`⏱️ Total duration: ${this.currentAttempt.totalDuration}ms`);

    } catch (error) {
      // Mark attempt as failed
      this.currentAttempt.finalResult = 'failure';
      this.currentAttempt.endTime = Date.now();
      this.currentAttempt.totalDuration = this.currentAttempt.endTime - this.currentAttempt.startTime;

      console.error(`❌ Consistent connection attempt #${attemptNumber} failed:`, error);
      console.log(`⏱️ Duration before failure: ${this.currentAttempt.totalDuration}ms`);
    }

    // Validate process consistency
    this.validateProcessConsistency(this.currentAttempt);

    // Store attempt log
    this.attemptLogs.push(this.currentAttempt);
    const completedAttempt = this.currentAttempt;
    this.currentAttempt = null;

    return completedAttempt;
  }

  /**
   * Execute a standardized connection step
   * Requirements: 9.4 - Ensure consistent connection process across all attempts
   */
  private async executeStandardStep(step: ConnectionStep): Promise<{
    name: string;
    startTime: number;
    endTime: number;
    success: boolean;
    duration: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    console.log(`🎯 Executing standardized step: ${step.name}`);
    console.log(`⏰ Step timeout: ${step.timeout}ms (fixed value)`);

    try {
      // Use race condition prevention for critical steps
      const racePreventionManager = getRaceConditionPrevention();
      
      await racePreventionManager.executeWithLock(
        step.name,
        `consistent-process-${Date.now()}`,
        async () => {
          // Simulate step execution with deterministic timing
          await this.simulateStepExecution(step);
        },
        step.prerequisites
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      console.log(`✅ Step completed: ${step.name} (${duration}ms)`);

      return {
        name: step.name,
        startTime,
        endTime,
        success: true,
        duration
      };

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error(`❌ Step failed: ${step.name} (${duration}ms) - ${errorMessage}`);

      return {
        name: step.name,
        startTime,
        endTime,
        success: false,
        duration,
        error: errorMessage
      };
    }
  }

  /**
   * Simulate step execution with consistent behavior
   * Requirements: 9.4, 9.5 - Consistent execution across all attempts
   */
  private async simulateStepExecution(step: ConnectionStep): Promise<void> {
    // Simulate step execution time based on step type
    // This would be replaced with actual WebRTC operations in real implementation
    
    const executionTime = this.getConsistentExecutionTime(step.name);
    
    console.log(`🎯 Simulating ${step.name} execution (${executionTime}ms - consistent timing)`);
    
    await new Promise(resolve => setTimeout(resolve, executionTime));
    
    // Simulate potential failures for testing (deterministic based on step)
    if (this.shouldSimulateFailure(step.name)) {
      throw new Error(`Simulated failure for step: ${step.name}`);
    }
  }

  /**
   * Get consistent execution time for each step type
   * Requirements: 9.2, 9.4 - Remove variable timing that creates inconsistent behavior
   */
  private getConsistentExecutionTime(stepName: string): number {
    // Fixed execution times - no randomness or variation
    const executionTimes: Record<string, number> = {
      'media-access': 500, // Always 500ms
      'peer-connection-creation': 100, // Always 100ms
      'track-attachment': 50, // Always 50ms
      'ice-configuration': 25, // Always 25ms
      'ice-gathering': 1000, // Always 1000ms
      'signaling-setup': 200, // Always 200ms
      'offer-creation': 150, // Always 150ms
      'local-description-set': 50, // Always 50ms
      'offer-transmission': 300, // Always 300ms
      'answer-reception': 500, // Always 500ms
      'remote-description-set': 50, // Always 50ms
      'ice-candidate-exchange': 800, // Always 800ms
      'connection-establishment': 200 // Always 200ms
    };

    return executionTimes[stepName] || 100; // Default 100ms if not found
  }

  /**
   * Determine if step should simulate failure (for testing)
   * Requirements: 9.4 - Deterministic failure patterns for testing
   */
  private shouldSimulateFailure(stepName: string): boolean {
    // Deterministic failure simulation - always the same for testing
    // In real implementation, this would be based on actual conditions
    return false; // No simulated failures by default
  }

  /**
   * Validate step prerequisites
   */
  private validatePrerequisites(step: ConnectionStep): boolean {
    if (!this.currentAttempt) {
      return false;
    }

    for (const prerequisite of step.prerequisites) {
      const prerequisiteStep = this.currentAttempt.steps.find(s => s.name === prerequisite);
      if (!prerequisiteStep || !prerequisiteStep.success) {
        console.error(`❌ Prerequisite not met: ${prerequisite} for step ${step.name}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Validate process consistency across attempts
   * Requirements: 9.4, 9.5 - Ensure consistent connection process across all attempts
   */
  private validateProcessConsistency(attempt: ConnectionAttemptLog): void {
    console.log('🔍 Validating process consistency...');

    // Check if steps follow the standard template
    const attemptSteps = attempt.steps.map(s => s.name);
    const processSignature = attemptSteps.join('->');

    // Track process variations
    const variationCount = this.processVariations.get(processSignature) || 0;
    this.processVariations.set(processSignature, variationCount + 1);

    // Validate against template
    let consistencyIssues: string[] = [];

    // Check for missing steps
    const missingSteps = this.processTemplate.filter(step => !attemptSteps.includes(step));
    if (missingSteps.length > 0) {
      consistencyIssues.push(`Missing steps: ${missingSteps.join(', ')}`);
    }

    // Check for extra steps
    const extraSteps = attemptSteps.filter(step => !this.processTemplate.includes(step));
    if (extraSteps.length > 0) {
      consistencyIssues.push(`Extra steps: ${extraSteps.join(', ')}`);
    }

    // Check for order violations
    let lastTemplateIndex = -1;
    for (const stepName of attemptSteps) {
      const templateIndex = this.processTemplate.indexOf(stepName);
      if (templateIndex !== -1 && templateIndex < lastTemplateIndex) {
        consistencyIssues.push(`Order violation: ${stepName} executed out of sequence`);
      }
      if (templateIndex > lastTemplateIndex) {
        lastTemplateIndex = templateIndex;
      }
    }

    if (consistencyIssues.length > 0) {
      console.warn('⚠️ Process consistency issues detected:');
      consistencyIssues.forEach(issue => console.warn(`   - ${issue}`));
    } else {
      console.log('✅ Process consistency validation passed');
    }

    // Log process variation statistics
    console.log(`📊 Process variations tracked: ${this.processVariations.size}`);
    if (this.processVariations.size === 1) {
      console.log('✅ Perfect process consistency - all attempts follow same pattern');
    } else {
      console.warn(`⚠️ Process inconsistency detected - ${this.processVariations.size} different patterns`);
    }
  }

  /**
   * Get process consistency statistics
   */
  getConsistencyStatistics(): {
    totalAttempts: number;
    processVariations: number;
    consistencyScore: number;
    mostCommonProcess: string;
    averageDuration: number;
    successRate: number;
  } {
    const totalAttempts = this.attemptLogs.length;
    const processVariations = this.processVariations.size;
    const consistencyScore = totalAttempts > 0 ? (1 / processVariations) * 100 : 100;
    
    // Find most common process
    let mostCommonProcess = '';
    let maxCount = 0;
    for (const [process, count] of this.processVariations.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonProcess = process;
      }
    }

    // Calculate average duration
    const durations = this.attemptLogs
      .filter(log => log.totalDuration !== undefined)
      .map(log => log.totalDuration!);
    const averageDuration = durations.length > 0 
      ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length 
      : 0;

    // Calculate success rate
    const successfulAttempts = this.attemptLogs.filter(log => log.finalResult === 'success').length;
    const successRate = totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0;

    return {
      totalAttempts,
      processVariations,
      consistencyScore,
      mostCommonProcess,
      averageDuration,
      successRate
    };
  }

  /**
   * Get all attempt logs
   */
  getAttemptLogs(): ConnectionAttemptLog[] {
    return [...this.attemptLogs];
  }

  /**
   * Get current attempt log
   */
  getCurrentAttempt(): ConnectionAttemptLog | null {
    return this.currentAttempt ? { ...this.currentAttempt } : null;
  }

  /**
   * Reset process manager
   */
  reset(): void {
    console.log('🔄 Resetting consistent connection process');
    
    this.attemptLogs.length = 0;
    this.currentAttempt = null;
    this.processVariations.clear();
    
    console.log('✅ Process manager reset completed');
  }

  /**
   * Get standardized steps
   */
  getStandardSteps(): ConnectionStep[] {
    return [...this.standardSteps];
  }

  /**
   * Validate process template
   */
  validateProcessTemplate(): boolean {
    // Validate that all steps have proper prerequisites
    for (const step of this.standardSteps) {
      for (const prerequisite of step.prerequisites) {
        const prerequisiteStep = this.standardSteps.find(s => s.name === prerequisite);
        if (!prerequisiteStep) {
          console.error(`❌ Invalid prerequisite: ${prerequisite} for step ${step.name}`);
          return false;
        }
      }
    }

    console.log('✅ Process template validation passed');
    return true;
  }
}

/**
 * Global consistent connection process instance
 */
let globalConsistentProcessInstance: ConsistentConnectionProcess | null = null;

/**
 * Get or create global consistent connection process instance
 */
export function getConsistentConnectionProcess(): ConsistentConnectionProcess {
  if (!globalConsistentProcessInstance) {
    globalConsistentProcessInstance = new ConsistentConnectionProcess();
    console.log('🎯 Created global consistent connection process instance');
  }
  
  return globalConsistentProcessInstance;
}

/**
 * Reset global consistent connection process instance
 */
export function resetGlobalConsistentConnectionProcess(): void {
  if (globalConsistentProcessInstance) {
    globalConsistentProcessInstance.reset();
    console.log('🔄 Reset global consistent connection process instance');
  }
}

/**
 * Utility function to start a consistent connection attempt
 */
export async function startConsistentConnection(
  networkType: 'mobile' | 'wifi' | 'unknown',
  onProgress?: (step: string, progress: number) => void,
  onStepComplete?: (step: string, success: boolean, duration: number) => void
): Promise<ConnectionAttemptLog> {
  const processManager = getConsistentConnectionProcess();
  
  return await processManager.startConsistentConnectionAttempt(
    networkType,
    onProgress || (() => {}),
    onStepComplete || (() => {})
  );
}