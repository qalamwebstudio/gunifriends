# Design Document: WebRTC Connection Lifecycle Fix

## Overview

This design implements a strict connection lifecycle rule to fix the critical issue where WebRTC calls establish successfully but pre-connection logic continues running, causing healthy calls to be destroyed after 40-60 seconds. The solution centers on a **CALL_IS_CONNECTED** global authority flag that immediately kills ALL pre-connection logic the moment a WebRTC connection is established.

The core principle is surgical precision: once `pc.connectionState === "connected"` OR `pc.iceConnectionState === "connected"`, all setup logic must be permanently terminated to prevent interference with the established call.

## Architecture

The fix implements a **Hard Connection Lifecycle Gate** with three core components:

1. **Global Authority Flag**: `CALL_IS_CONNECTED` - single source of truth for connection state
2. **Immediate Termination Function**: `killAllPreConnectionLogic()` - centralized cleanup of all pre-connection processes  
3. **Process Registry**: Tracks all timeouts, intervals, and async controllers for reliable termination

```mermaid
graph TB
    A[WebRTC Connection Event] --> B{pc.connectionState === 'connected' OR<br/>pc.iceConnectionState === 'connected'}
    B -->|Yes| C[Set CALL_IS_CONNECTED = true]
    C --> D[Execute killAllPreConnectionLogic()]
    D --> E[Clear initialConnectionTimeout]
    D --> F[Stop networkDetectionInterval]
    D --> G[Abort all network probes]
    D --> H[Disable NAT reclassification]
    D --> I[Block reconnection logic]
    D --> J[Prevent ICE policy changes]
    
    K[Latency Spike/Timeout] --> L{CALL_IS_CONNECTED?}
    L -->|true| M[BLOCKED - No Action]
    L -->|false| N[Allow pre-connection logic]
    
    O[Actual WebRTC Failure] --> P{pc.connectionState === 'failed'<br/>OR 'closed'}
    P -->|Yes| Q[Reset CALL_IS_CONNECTED = false]
    Q --> R[Allow recovery attempts]
```

## Components and Interfaces

### Global Authority Flag Implementation

**CALL_IS_CONNECTED Flag**:
```typescript
// Global state - single source of truth
let CALL_IS_CONNECTED = false;

// Connection state monitoring
function onConnectionStateChange(pc: RTCPeerConnection) {
  if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') {
    if (!CALL_IS_CONNECTED) {
      CALL_IS_CONNECTED = true;
      killAllPreConnectionLogic();
    }
  } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
    CALL_IS_CONNECTED = false; // Allow recovery for actual failures
  }
}
```

### Centralized Pre-Connection Logic Termination

**Process Registry**:
```typescript
interface PreConnectionProcesses {
  timeouts: Set<NodeJS.Timeout>;
  intervals: Set<NodeJS.Timeout>;
  abortControllers: Set<AbortController>;
  networkProbes: Set<Promise<any>>;
}

const preConnectionRegistry: PreConnectionProcesses = {
  timeouts: new Set(),
  intervals: new Set(),
  abortControllers: new Set(),
  networkProbes: new Set()
};
```

**killAllPreConnectionLogic() Function**:
```typescript
function killAllPreConnectionLogic(): void {
  // Clear all timeouts
  preConnectionRegistry.timeouts.forEach(timeout => clearTimeout(timeout));
  preConnectionRegistry.timeouts.clear();
  
  // Clear all intervals
  preConnectionRegistry.intervals.forEach(interval => clearInterval(interval));
  preConnectionRegistry.intervals.clear();
  
  // Abort all async operations
  preConnectionRegistry.abortControllers.forEach(controller => controller.abort());
  preConnectionRegistry.abortControllers.clear();
  
  // Cancel network probes
  preConnectionRegistry.networkProbes.clear();
  
  console.log('All pre-connection logic terminated - call is connected');
}
```

### Protected Pre-Connection Logic Registration

**Timeout Registration**:
```typescript
function registerTimeout(callback: () => void, delay: number): NodeJS.Timeout {
  if (CALL_IS_CONNECTED) {
    console.warn('Blocked: Cannot create timeout after connection established');
    return null;
  }
  
  const timeout = setTimeout(() => {
    preConnectionRegistry.timeouts.delete(timeout);
    callback();
  }, delay);
  
  preConnectionRegistry.timeouts.add(timeout);
  return timeout;
}
```

**Network Detection Prevention**:
```typescript
function startNetworkDetection(): void {
  if (CALL_IS_CONNECTED) {
    console.warn('Blocked: Network detection not allowed after connection');
    return;
  }
  
  const interval = setInterval(detectNetworkEnvironment, 5000);
  preConnectionRegistry.intervals.add(interval);
}
```

## Data Models

### Connection Lifecycle State
```typescript
interface ConnectionLifecycleState {
  isConnected: boolean;           // CALL_IS_CONNECTED flag
  connectionEstablishedAt: Date;  // Timestamp when connection succeeded
  preConnectionKilled: boolean;   // Confirmation that cleanup executed
  allowedOperations: {
    networkDetection: boolean;    // false after connection
    iceReconfiguration: boolean;  // false after connection
    reconnectionAttempts: boolean; // false after connection
    qualityMonitoring: boolean;   // true after connection (getStats only)
  };
}
```

### Pre-Connection Process Registry
```typescript
interface PreConnectionProcess {
  id: string;
  type: 'timeout' | 'interval' | 'abortController' | 'networkProbe';
  handle: NodeJS.Timeout | AbortController | Promise<any>;
  description: string;
  createdAt: Date;
}

interface ProcessRegistry {
  processes: Map<string, PreConnectionProcess>;
  isKilled: boolean;
  killedAt?: Date;
}
```

### Strict Connection Rules Configuration
```typescript
interface StrictConnectionConfig {
  // Connection detection triggers
  connectionTriggers: {
    useConnectionState: boolean;    // Monitor pc.connectionState === 'connected'
    useIceConnectionState: boolean; // Monitor pc.iceConnectionState === 'connected'
  };
  
  // Failure recovery conditions
  recoveryTriggers: {
    connectionStateFailed: boolean; // Allow recovery on pc.connectionState === 'failed'
    connectionStateClosed: boolean; // Allow recovery on pc.connectionState === 'closed'
    iceConnectionFailed: boolean;   // Allow recovery on pc.iceConnectionState === 'failed'
  };
  
  // Blocked operations after connection
  blockedAfterConnection: {
    initialConnectionTimeout: boolean;
    networkDetectionInterval: boolean;
    natReclassification: boolean;
    iceTransportPolicyChange: boolean;
    peerConnectionRecreation: boolean;
    reconnectionLogic: boolean;
  };
}

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Converting EARS to Properties

Based on the prework analysis, here are the consolidated correctness properties:

**Property 1: Connection State Authority**
*For any* RTCPeerConnection with connectionState === "connected" OR iceConnectionState === "connected", the CALL_IS_CONNECTED flag should be set to true immediately
**Validates: Requirements 1.1**

**Property 2: Immediate Cleanup Execution**
*For any* transition of CALL_IS_CONNECTED from false to true, the killAllPreConnectionLogic() function should be executed exactly once immediately
**Validates: Requirements 1.2**

**Property 3: Complete Process Termination**
*For any* registered pre-connection processes (timeouts, intervals, abort controllers), calling killAllPreConnectionLogic() should clear/abort all of them and leave the registry empty
**Validates: Requirements 1.3, 1.4, 5.3**

**Property 4: Pre-Connection Logic Blocking**
*For any* attempt to start pre-connection logic (timeouts, network detection, NAT reclassification, ICE policy changes) when CALL_IS_CONNECTED = true, the attempt should be blocked and no process should be created
**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2**

**Property 5: Reconnection Logic Prevention**
*For any* event that would normally trigger reconnection (latency spikes, visibility changes, temporary disconnections) when CALL_IS_CONNECTED = true, no reconnection logic should execute
**Validates: Requirements 1.5, 3.5, 4.3, 4.4**

**Property 6: Quality Monitoring Restriction**
*For any* quality adaptation operation when CALL_IS_CONNECTED = true, only getStats() method should be used and no connection modification methods should be called
**Validates: Requirements 3.4**

**Property 7: Peer Connection Protection**
*For any* attempt to recreate RTCPeerConnection objects when CALL_IS_CONNECTED = true, the attempt should be blocked and the existing connection should remain unchanged
**Validates: Requirements 3.3**

**Property 8: Failure State Recovery**
*For any* RTCPeerConnection with connectionState === "failed" OR connectionState === "closed", connection recovery attempts should be allowed and CALL_IS_CONNECTED should be reset to false
**Validates: Requirements 4.1, 4.2**

**Property 9: Process Registry Maintenance**
*For any* pre-connection process created (timeout, interval, abort controller), it should be automatically registered in the process registry and remain there until killAllPreConnectionLogic() is called
**Validates: Requirements 5.1, 5.2, 5.4**

**Property 10: Lifecycle Gate Enforcement**
*For any* attempt to restart pre-connection logic after killAllPreConnectionLogic() has been executed, the attempt should be permanently blocked until CALL_IS_CONNECTED is reset to false
**Validates: Requirements 5.5**

## Error Handling

### Connection Lifecycle Gate Failures
- If CALL_IS_CONNECTED flag fails to set, log error and attempt manual cleanup
- If killAllPreConnectionLogic() fails to execute, retry once and log failure
- If process registry becomes corrupted, reinitialize and log warning
- Provide fallback mechanism to manually trigger lifecycle gate

### Process Termination Failures
- If timeout/interval clearing fails, attempt direct handle invalidation
- If AbortController.abort() fails, log error and continue with other cleanup
- If network probe cancellation fails, mark as abandoned and continue
- Never allow partial cleanup - either all processes terminate or none

### Connection State Monitoring Failures
- If connection state events stop firing, implement polling fallback
- If multiple connection state changes occur rapidly, debounce to prevent race conditions
- If connection state becomes inconsistent, prioritize actual WebRTC state over internal flags
- Implement connection state validation before making lifecycle decisions

### Recovery Logic Failures
- If CALL_IS_CONNECTED reset fails during actual failures, force reset and log error
- If recovery attempts are blocked incorrectly, provide manual override mechanism
- If connection state detection fails, default to allowing recovery for safety
- Implement recovery state validation to prevent infinite loops

## Testing Strategy

### Dual Testing Approach
This fix requires both unit tests and property-based tests to ensure the strict connection lifecycle rules are enforced:

**Unit Tests** will verify:
- Specific connection state transitions and flag setting
- Error handling for cleanup failures and edge cases
- Integration between lifecycle gate and existing WebRTC components
- Edge cases like rapid connection state changes or registry corruption

**Property-Based Tests** will verify:
- Universal properties across all connection scenarios and timing variations
- Process termination behavior across various pre-connection logic combinations
- Blocking behavior across different types of reconnection triggers
- Registry management across various process creation and cleanup patterns

### Property-Based Testing Configuration
- Use Jest with fast-check library for property-based testing
- Configure each test to run minimum 100 iterations due to timing-sensitive nature
- Each property test must reference its design document property
- Tag format: **Feature: fix-auto-disconnect, Property {number}: {property_text}**

### Testing Focus Areas
1. **Connection Lifecycle Gate Testing**: Verify immediate flag setting and cleanup execution
2. **Process Termination Testing**: Validate complete cleanup of all registered processes
3. **Blocking Logic Testing**: Ensure all pre-connection logic is blocked after connection
4. **Recovery State Testing**: Verify proper recovery behavior for actual failures only
5. **Registry Management Testing**: Test process registration and cleanup coordination
6. **Race Condition Testing**: Test behavior under rapid connection state changes
7. **Failure Simulation Testing**: Test error handling and fallback mechanisms