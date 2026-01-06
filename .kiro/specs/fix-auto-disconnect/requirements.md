# Requirements Document

## Introduction

This specification addresses the critical issue where WebRTC calls establish successfully (ICE = connected, remote stream received) but the app continues running pre-connection logic (network detection, timeouts, retries). When latency spikes or timeouts fire, the app mistakenly triggers reconnection logic and destroys healthy calls after ~40–60 seconds. The root cause is that pre-connection logic runs from multiple sources without a single authoritative signal that the call is connected. The solution requires implementing a HARD connection lifecycle gate that immediately kills ALL pre-connection logic once connected.

## Glossary

- **VideoChat_Component**: The React component managing WebRTC video chat functionality
- **Socket_Server**: The Node.js server handling WebSocket connections and signaling
- **WebRTC_Manager**: The class managing WebRTC connection state and lifecycle
- **CALL_IS_CONNECTED**: Global authority flag indicating when a WebRTC call is successfully connected
- **Pre_Connection_Logic**: All logic that runs before connection establishment (timeouts, intervals, network detection, retries)
- **Connection_Lifecycle_Gate**: The mechanism that enforces strict separation between pre-connection and post-connection states
- **killAllPreConnectionLogic()**: Centralized function that immediately terminates all pre-connection processes
- **Initial_Connection_Timeout**: Timer that fires during connection setup phase only
- **Network_Detection_Interval**: Periodic network environment probing that must stop after connection
- **Reconnection_Logic**: Logic that attempts to recreate RTCPeerConnection (forbidden after successful connection)

## Requirements

### Requirement 1: Implement Hard Connection Lifecycle Gate

**User Story:** As a user, I want my WebRTC call to remain stable once connected, so that pre-connection logic never interferes with an established call.

#### Acceptance Criteria

1. WHEN pc.connectionState === "connected" OR pc.iceConnectionState === "connected" THEN the system SHALL set CALL_IS_CONNECTED = true immediately
2. WHEN CALL_IS_CONNECTED becomes true THEN the system SHALL execute killAllPreConnectionLogic() function immediately
3. THE killAllPreConnectionLogic() function SHALL clear all registered timeouts and intervals from pre-connection phase
4. THE killAllPreConnectionLogic() function SHALL abort all async controllers used for network probes
5. THE killAllPreConnectionLogic() function SHALL permanently block reconnection logic unless WebRTC enters FAILED state

### Requirement 2: Eliminate Pre-Connection Logic After Connection

**User Story:** As a user, I want all connection setup logic to stop immediately once my call connects, so that setup timeouts never fire during my conversation.

#### Acceptance Criteria

1. WHEN CALL_IS_CONNECTED = true THEN the Initial_Connection_Timeout SHALL be cleared and never fire
2. WHEN CALL_IS_CONNECTED = true THEN the Network_Detection_Interval SHALL be stopped permanently
3. WHEN CALL_IS_CONNECTED = true THEN all network environment probes SHALL be aborted
4. WHEN CALL_IS_CONNECTED = true THEN NAT reclassification logic SHALL be disabled
5. WHEN CALL_IS_CONNECTED = true THEN ICE policy changes SHALL be prevented

### Requirement 3: Strict Post-Connection Behavior Rules

**User Story:** As a user, I want the system to only use quality monitoring after connection, so that no reconnection attempts destroy my healthy call.

#### Acceptance Criteria

1. WHEN CALL_IS_CONNECTED = true THEN the system SHALL NOT run network detection logic
2. WHEN CALL_IS_CONNECTED = true THEN the system SHALL NOT change ICE transport policy
3. WHEN CALL_IS_CONNECTED = true THEN the system SHALL NOT recreate RTCPeerConnection objects
4. WHEN CALL_IS_CONNECTED = true THEN the system SHALL ONLY use getStats() for quality adaptation
5. WHEN latency spikes occur THEN the system SHALL NOT trigger any reconnection logic

### Requirement 4: Connection Recovery Only for Actual Failures

**User Story:** As a user, I want connection recovery to only happen when WebRTC actually fails, so that temporary issues don't end my call.

#### Acceptance Criteria

1. WHEN pc.connectionState === "failed" THEN the system SHALL allow connection recovery attempts
2. WHEN pc.connectionState === "closed" THEN the system SHALL allow connection recovery attempts
3. WHEN pc.connectionState === "disconnected" temporarily THEN the system SHALL NOT trigger reconnection
4. WHEN visibility changes occur THEN the system SHALL NOT trigger reconnection logic
5. THE system SHALL distinguish between temporary disconnection and permanent failure states

### Requirement 5: Centralized Pre-Connection Logic Management

**User Story:** As a developer, I want all pre-connection processes managed centrally, so that the lifecycle gate can reliably terminate them all.

#### Acceptance Criteria

1. THE system SHALL maintain a registry of all pre-connection timeouts and intervals
2. THE system SHALL maintain a registry of all pre-connection async controllers
3. THE killAllPreConnectionLogic() function SHALL access and terminate all registered processes
4. WHEN new pre-connection logic is added THEN it SHALL be registered for lifecycle management
5. THE Connection_Lifecycle_Gate SHALL prevent any pre-connection logic from restarting after connection