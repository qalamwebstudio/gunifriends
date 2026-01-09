# Requirements Document

## Introduction

This specification addresses the critical performance issue where WebRTC peer-to-peer connections take 20-60 seconds or fail randomly, particularly on mobile networks and college Wi-Fi. The current implementation exhibits unpredictable behavior due to inefficient ICE strategies, late TURN fallback, and suboptimal execution order. The solution requires implementing a TURN-first strategy, aggressive timeout control, and deterministic connection behavior to achieve consistent ~5 second connection times across all network conditions.

## Glossary

- **ICE_Candidate_Gathering**: The process of discovering network paths for WebRTC connection
- **TURN_Server**: Relay server that forwards media traffic when direct connection fails
- **STUN_Server**: Server that helps discover public IP address for NAT traversal
- **TURN_First_Strategy**: Prioritizing TURN relay candidates early in ICE gathering
- **ICE_Gathering_Timeout**: Maximum time allowed for collecting network candidates
- **Relay_Candidate**: Network path that routes through TURN server
- **Host_Candidate**: Direct network path without relay
- **Srflx_Candidate**: Server reflexive candidate discovered via STUN
- **NAT_Traversal**: Technique for establishing connections through network firewalls
- **CGNAT**: Carrier Grade NAT used by mobile networks that blocks direct connections
- **Symmetric_NAT**: Restrictive NAT type that requires TURN relay for connections
- **ICE_Restart**: Process of re-gathering candidates when connection fails
- **Connection_Establishment_Time**: Duration from signaling start to first remote video frame
- **Network_Probing**: Pre-connection testing that may delay actual connection attempts
- **Media_Track_Attachment**: Adding audio/video streams to peer connection before signaling

## Requirements

### Requirement 1: TURN-First ICE Strategy Implementation

**User Story:** As a user on mobile data or college Wi-Fi, I want connections to establish quickly and reliably, so that I don't experience long waits or random failures when trying to video chat.

#### Acceptance Criteria

1. THE system SHALL configure at least two TURN servers in ICE configuration: one UDP and one TCP fallback
2. WHEN ICE gathering begins THEN TURN candidates SHALL be gathered in parallel with STUN candidates, not sequentially
3. THE system SHALL NOT wait for STUN failure before attempting TURN relay connections
4. WHEN multiple candidate types are available THEN TURN relay candidates SHALL be prioritized for mobile and CGNAT networks
5. THE system SHALL allow STUN and TURN to race in parallel, selecting the fastest successful connection

### Requirement 2: Aggressive ICE Timeout Control

**User Story:** As a user, I want connections to establish within 5 seconds consistently, so that I can start conversations quickly without unpredictable delays.

#### Acceptance Criteria

1. THE system SHALL limit ICE gathering timeout to maximum 5 seconds
2. WHEN no viable ICE candidates are found after 3 seconds THEN the system SHALL force TURN relay mode immediately
3. THE system SHALL stop further STUN probing once TURN relay is forced
4. THE system SHALL NOT perform redundant ICE restarts that extend connection time
5. WHEN ICE gathering timeout is reached THEN connection attempt SHALL proceed with available candidates

### Requirement 3: Optimized Media Track Attachment Order

**User Story:** As a developer, I want media tracks attached before ICE gathering to avoid renegotiation delays, so that connection establishment is efficient and predictable.

#### Acceptance Criteria

1. WHEN peer connection is created THEN media tracks SHALL be attached before calling createOffer()
2. THE system SHALL NOT initialize peer connection UI before media stream is fully ready
3. WHEN media tracks are attached THEN ICE gathering SHALL begin immediately
4. THE system SHALL avoid SDP renegotiation by ensuring media readiness before signaling
5. WHEN createOffer() is called THEN all local media tracks SHALL already be present on peer connection

### Requirement 4: Eliminate Unnecessary Network Probing

**User Story:** As a user, I want connections to start immediately without delays from network tests, so that I can connect as fast as possible.

#### Acceptance Criteria

1. THE system SHALL NOT perform NAT type detection before connection attempts
2. THE system SHALL NOT perform bandwidth tests before matching users
3. THE system SHALL NOT perform pre-connection quality checks that delay connection establishment
4. THE system SHALL NOT make redundant STUN discovery calls beyond ICE gathering
5. WHEN network probing is removed THEN connection attempts SHALL begin immediately after media readiness

### Requirement 5: Parallel ICE and Signaling Execution

**User Story:** As a developer, I want ICE gathering and signaling to happen concurrently, so that no time is wasted waiting for sequential operations.

#### Acceptance Criteria

1. WHEN media tracks are attached and signaling is ready THEN ICE gathering SHALL start immediately
2. THE system SHALL NOT block ICE gathering on UI animations or connection indicators
3. WHEN ICE candidates are discovered THEN they SHALL be sent to peer immediately without batching delays
4. THE system SHALL NOT wait for complete ICE gathering before beginning offer/answer exchange
5. WHEN signaling completes THEN connection establishment SHALL proceed with available candidates

### Requirement 6: Connection Time Performance Targets

**User Story:** As a user, I want consistent connection performance across all network types, so that my experience is predictable regardless of my network environment.

#### Acceptance Criteria

1. THE system SHALL achieve connection establishment within 5 seconds for 90% of connection attempts
2. WHEN testing on mobile data (4G/5G) THEN average connection time SHALL be under 5 seconds
3. WHEN testing on college Wi-Fi THEN average connection time SHALL be under 5 seconds  
4. WHEN testing through symmetric NAT THEN connection SHALL succeed within 5 seconds using TURN relay
5. THE system SHALL measure time from "Start Matching" to first remote video frame display

### Requirement 7: Deterministic Connection Behavior

**User Story:** As a user, I want connections to behave consistently every time, so that I can rely on the system working predictably.

#### Acceptance Criteria

1. THE system SHALL eliminate random connection failures by using deterministic ICE strategies
2. WHEN network conditions are similar THEN connection establishment time SHALL vary by less than 2 seconds
3. THE system SHALL NOT exhibit different behavior between connection attempts on the same network
4. WHEN TURN servers are available THEN they SHALL be used consistently for restrictive networks
5. THE system SHALL provide predictable fallback behavior when primary connection methods fail

### Requirement 8: ICE Configuration Optimization

**User Story:** As a developer, I want optimized ICE server configuration that prioritizes speed and reliability, so that connections establish quickly across all network types.

#### Acceptance Criteria

1. THE system SHALL configure ICE servers with both UDP and TCP TURN options
2. WHEN ICE transport policy is set THEN it SHALL prefer relay candidates for mobile networks
3. THE system SHALL limit ICE candidate pool size to reduce gathering time
4. WHEN TURN credentials are available THEN they SHALL be reused across connection attempts in the same session
5. THE system SHALL cache successful ICE configuration per user session for faster subsequent connections

### Requirement 9: Remove Connection Randomness Sources

**User Story:** As a user, I want reliable connections without random failures, so that I can trust the system to work when I need it.

#### Acceptance Criteria

1. THE system SHALL NOT rely on STUN-only logic that fails unpredictably on restrictive networks
2. THE system SHALL NOT use variable timeout values that create inconsistent behavior
3. WHEN connection attempts are made THEN they SHALL follow the same deterministic process every time
4. THE system SHALL NOT have race conditions between ICE gathering and signaling that cause random failures
5. WHEN network conditions change THEN the system SHALL adapt using predictable fallback strategies

### Requirement 10: Performance Monitoring and Validation

**User Story:** As a developer, I want to measure and validate connection performance improvements, so that I can ensure the optimizations are working effectively.

#### Acceptance Criteria

1. THE system SHALL log connection establishment timing from signaling start to remote video display
2. WHEN connections are established THEN success rate SHALL be measured and reported
3. THE system SHALL track ICE candidate types used for successful connections
4. WHEN performance testing is conducted THEN results SHALL show consistent sub-5-second connection times
5. THE system SHALL provide metrics for connection reliability across different network types