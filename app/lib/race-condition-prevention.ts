/**
 * Race Condition Prevention for WebRTC Connections
 * 
 * Prevents race conditions between ICE gathering and signaling by:
 * - Implementing proper sequencing locks
 * - Ensuring deterministic execution order
 * - Coordinating async operations
 * - Preventing concurrent state modifications
 * 
 * Requirements: 9.3, 9.4 - Fix race conditions between ICE gathering and signaling
 */

export interface SequenceState {
  mediaReady: boolean;
  peerConnectionCreated: boolean;
  tracksAttached: boolean;
  iceGatheringStarted: boolean;
  signalingStarted: boolean;
  offerCreated: boolean;
  answerCreated: boolean;
  localDescriptionSet: boolean;
  remoteDescriptionSet: boolean;
  connectionEstablished: boolean;
}

export interface OperationLock {
  name: string;
  acquired: boolean;
  acquiredAt: number;
  owner: string;
}

/**
 * Race Condition Prevention Manager
 * 
 * Coordinates WebRTC operations to prevent race conditions and ensure
 * deterministic execution order across all connection attempts.
 */
export class RaceConditionPrevention {
  private sequenceState: SequenceState;
  private operationLocks: Map<string, OperationLock> = new Map();
  private executionQueue: Array<{ name: string; operation: () => Promise<void> }> = [];
  private isProcessingQueue = false;
  
  // Sequence validation
  private requiredSequence = [
    'media-access',
    'peer-connection-creation',
    'track-attachment',
    'ice-gathering-start',
    'signaling-start',
    'offer-creation',
    'local-description-set',
    'remote-description-set',
    'connection-establishment'
  ];
  
  private completedSteps: Set<string> = new Set();

  constructor() {
    this.sequenceState = {
      mediaReady: false,
      peerConnectionCreated: false,
      tracksAttached: false,
      iceGatheringStarted: false,
      signalingStarted: false,
      offerCreated: false,
      answerCreated: false,
      localDescriptionSet: false,
      remoteDescriptionSet: false,
      connectionEstablished: false
    };

    console.log('🔒 Race Condition Prevention initialized');
    console.log('🎯 Deterministic sequence enforcement enabled');
  }

  /**
   * Acquire operation lock to prevent race conditions
   * Requirements: 9.3 - Fix race conditions between ICE gathering and signaling
   */
  async acquireOperationLock(
    operationName: string,
    owner: string,
    timeoutMs: number = 5000
  ): Promise<boolean> {
    const existingLock = this.operationLocks.get(operationName);
    
    if (existingLock && existingLock.acquired) {
      console.warn(`⚠️ Operation lock "${operationName}" already acquired by ${existingLock.owner}`);
      console.warn('🔒 Preventing race condition - operation blocked');
      return false;
    }

    const lock: OperationLock = {
      name: operationName,
      acquired: true,
      acquiredAt: Date.now(),
      owner
    };

    this.operationLocks.set(operationName, lock);
    console.log(`🔒 Acquired operation lock: ${operationName} (owner: ${owner})`);

    // Set timeout to automatically release lock
    setTimeout(() => {
      this.releaseOperationLock(operationName, owner);
    }, timeoutMs);

    return true;
  }

  /**
   * Release operation lock
   */
  releaseOperationLock(operationName: string, owner: string): boolean {
    const lock = this.operationLocks.get(operationName);
    
    if (!lock) {
      console.warn(`⚠️ No lock found for operation: ${operationName}`);
      return false;
    }

    if (lock.owner !== owner) {
      console.warn(`⚠️ Lock owner mismatch for ${operationName}: expected ${lock.owner}, got ${owner}`);
      return false;
    }

    this.operationLocks.delete(operationName);
    console.log(`🔓 Released operation lock: ${operationName} (owner: ${owner})`);
    return true;
  }

  /**
   * Execute operation with race condition prevention
   * Requirements: 9.3, 9.4 - Ensure consistent connection process across all attempts
   */
  async executeWithLock<T>(
    operationName: string,
    owner: string,
    operation: () => Promise<T>,
    prerequisites: string[] = []
  ): Promise<T> {
    // Check prerequisites
    for (const prerequisite of prerequisites) {
      if (!this.completedSteps.has(prerequisite)) {
        throw new Error(`Cannot execute ${operationName}: prerequisite ${prerequisite} not completed`);
      }
    }

    // Acquire lock
    const lockAcquired = await this.acquireOperationLock(operationName, owner);
    if (!lockAcquired) {
      throw new Error(`Failed to acquire lock for operation: ${operationName}`);
    }

    try {
      console.log(`🎯 Executing operation with race prevention: ${operationName}`);
      const result = await operation();
      
      // Mark step as completed
      this.completedSteps.add(operationName);
      console.log(`✅ Completed operation: ${operationName}`);
      
      return result;
    } finally {
      this.releaseOperationLock(operationName, owner);
    }
  }

  /**
   * Coordinate ICE gathering and signaling to prevent race conditions
   * Requirements: 9.3 - Fix race conditions between ICE gathering and signaling
   */
  async coordinateICEAndSignaling(
    iceGatheringOperation: () => Promise<void>,
    signalingOperation: () => Promise<void>,
    owner: string
  ): Promise<void> {
    console.log('🔄 Coordinating ICE gathering and signaling to prevent race conditions');

    // Ensure proper prerequisites are met
    if (!this.sequenceState.tracksAttached) {
      throw new Error('Cannot start ICE/signaling coordination: tracks not attached');
    }

    // Execute ICE gathering first with lock
    await this.executeWithLock(
      'ice-gathering-coordination',
      owner,
      async () => {
        this.sequenceState.iceGatheringStarted = true;
        console.log('🧊 Starting ICE gathering (race condition prevented)');
        await iceGatheringOperation();
      },
      ['track-attachment']
    );

    // Execute signaling second with lock (after ICE gathering is started)
    await this.executeWithLock(
      'signaling-coordination',
      owner,
      async () => {
        this.sequenceState.signalingStarted = true;
        console.log('📡 Starting signaling (race condition prevented)');
        await signalingOperation();
      },
      ['ice-gathering-coordination']
    );

    console.log('✅ ICE gathering and signaling coordination completed without race conditions');
  }

  /**
   * Validate sequence order to prevent execution order violations
   * Requirements: 9.4 - Ensure consistent connection process across all attempts
   */
  validateSequenceOrder(stepName: string): boolean {
    const stepIndex = this.requiredSequence.indexOf(stepName);
    
    if (stepIndex === -1) {
      console.warn(`⚠️ Unknown sequence step: ${stepName}`);
      return false;
    }

    // Check that all previous steps are completed
    for (let i = 0; i < stepIndex; i++) {
      const previousStep = this.requiredSequence[i];
      if (!this.completedSteps.has(previousStep)) {
        console.error(`❌ Sequence violation: ${stepName} attempted before ${previousStep}`);
        console.error('🎯 Required sequence order:', this.requiredSequence);
        console.error('🎯 Completed steps:', Array.from(this.completedSteps));
        return false;
      }
    }

    console.log(`✅ Sequence validation passed for step: ${stepName}`);
    return true;
  }

  /**
   * Queue operation for sequential execution
   * Requirements: 9.3, 9.4 - Prevent concurrent operations that cause race conditions
   */
  queueOperation(name: string, operation: () => Promise<void>): void {
    this.executionQueue.push({ name, operation });
    console.log(`📋 Queued operation: ${name} (queue length: ${this.executionQueue.length})`);
    
    // Process queue if not already processing
    if (!this.isProcessingQueue) {
      this.processExecutionQueue();
    }
  }

  /**
   * Process execution queue sequentially
   */
  private async processExecutionQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;
    console.log('🔄 Processing execution queue sequentially');

    try {
      while (this.executionQueue.length > 0) {
        const { name, operation } = this.executionQueue.shift()!;
        
        console.log(`🎯 Executing queued operation: ${name}`);
        
        try {
          await operation();
          console.log(`✅ Completed queued operation: ${name}`);
        } catch (error) {
          console.error(`❌ Failed queued operation: ${name}`, error);
          // Continue processing other operations
        }
      }
    } finally {
      this.isProcessingQueue = false;
      console.log('✅ Execution queue processing completed');
    }
  }

  /**
   * Update sequence state with validation
   */
  updateSequenceState(updates: Partial<SequenceState>): boolean {
    const oldState = { ...this.sequenceState };
    
    try {
      // Apply updates
      Object.assign(this.sequenceState, updates);
      
      // Validate state consistency
      if (!this.validateStateConsistency()) {
        // Rollback on validation failure
        this.sequenceState = oldState;
        console.error('❌ State update failed validation - rolled back');
        return false;
      }
      
      console.log('✅ Sequence state updated:', updates);
      return true;
    } catch (error) {
      // Rollback on error
      this.sequenceState = oldState;
      console.error('❌ State update failed - rolled back:', error);
      return false;
    }
  }

  /**
   * Validate state consistency
   */
  private validateStateConsistency(): boolean {
    const state = this.sequenceState;
    
    // ICE gathering cannot start before tracks are attached
    if (state.iceGatheringStarted && !state.tracksAttached) {
      console.error('❌ State inconsistency: ICE gathering started before tracks attached');
      return false;
    }
    
    // Signaling cannot start before peer connection is created
    if (state.signalingStarted && !state.peerConnectionCreated) {
      console.error('❌ State inconsistency: Signaling started before peer connection created');
      return false;
    }
    
    // Offer cannot be created before tracks are attached
    if (state.offerCreated && !state.tracksAttached) {
      console.error('❌ State inconsistency: Offer created before tracks attached');
      return false;
    }
    
    // Local description cannot be set before offer/answer is created
    if (state.localDescriptionSet && !state.offerCreated && !state.answerCreated) {
      console.error('❌ State inconsistency: Local description set before offer/answer created');
      return false;
    }
    
    console.log('✅ State consistency validation passed');
    return true;
  }

  /**
   * Get current sequence state
   */
  getSequenceState(): SequenceState {
    return { ...this.sequenceState };
  }

  /**
   * Get active operation locks
   */
  getActiveOperationLocks(): OperationLock[] {
    return Array.from(this.operationLocks.values());
  }

  /**
   * Get completed steps
   */
  getCompletedSteps(): string[] {
    return Array.from(this.completedSteps);
  }

  /**
   * Get remaining steps
   */
  getRemainingSteps(): string[] {
    return this.requiredSequence.filter(step => !this.completedSteps.has(step));
  }

  /**
   * Reset race condition prevention state
   */
  reset(): void {
    console.log('🔄 Resetting race condition prevention state');
    
    // Clear all locks
    this.operationLocks.clear();
    
    // Clear execution queue
    this.executionQueue.length = 0;
    this.isProcessingQueue = false;
    
    // Reset sequence state
    this.sequenceState = {
      mediaReady: false,
      peerConnectionCreated: false,
      tracksAttached: false,
      iceGatheringStarted: false,
      signalingStarted: false,
      offerCreated: false,
      answerCreated: false,
      localDescriptionSet: false,
      remoteDescriptionSet: false,
      connectionEstablished: false
    };
    
    // Clear completed steps
    this.completedSteps.clear();
    
    console.log('✅ Race condition prevention state reset');
  }

  /**
   * Get race condition prevention status
   */
  getStatus(): {
    sequenceState: SequenceState;
    activeLocks: OperationLock[];
    completedSteps: string[];
    remainingSteps: string[];
    queueLength: number;
    isProcessingQueue: boolean;
  } {
    return {
      sequenceState: this.getSequenceState(),
      activeLocks: this.getActiveOperationLocks(),
      completedSteps: this.getCompletedSteps(),
      remainingSteps: this.getRemainingSteps(),
      queueLength: this.executionQueue.length,
      isProcessingQueue: this.isProcessingQueue
    };
  }
}

/**
 * Global race condition prevention instance
 */
let globalRacePreventionInstance: RaceConditionPrevention | null = null;

/**
 * Get or create global race condition prevention instance
 */
export function getRaceConditionPrevention(): RaceConditionPrevention {
  if (!globalRacePreventionInstance) {
    globalRacePreventionInstance = new RaceConditionPrevention();
    console.log('🔒 Created global race condition prevention instance');
  }
  
  return globalRacePreventionInstance;
}

/**
 * Reset global race condition prevention instance
 */
export function resetGlobalRaceConditionPrevention(): void {
  if (globalRacePreventionInstance) {
    globalRacePreventionInstance.reset();
    console.log('🔄 Reset global race condition prevention instance');
  }
}

/**
 * Utility function to execute WebRTC operations with race condition prevention
 */
export async function executeWithRaceConditionPrevention<T>(
  operationName: string,
  operation: () => Promise<T>,
  prerequisites: string[] = []
): Promise<T> {
  const racePreventionManager = getRaceConditionPrevention();
  const owner = `webrtc-${Date.now()}`;
  
  return await racePreventionManager.executeWithLock(
    operationName,
    owner,
    operation,
    prerequisites
  );
}

/**
 * Utility function to coordinate ICE and signaling operations
 */
export async function coordinateICEAndSignaling(
  iceGatheringOperation: () => Promise<void>,
  signalingOperation: () => Promise<void>
): Promise<void> {
  const racePreventionManager = getRaceConditionPrevention();
  const owner = `coordination-${Date.now()}`;
  
  return await racePreventionManager.coordinateICEAndSignaling(
    iceGatheringOperation,
    signalingOperation,
    owner
  );
}