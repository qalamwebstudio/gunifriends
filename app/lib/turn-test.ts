/**
 * TURN Server Connectivity Test
 * Use this to verify TURN servers are working properly
 */

export interface TURNTestResult {
  server: string;
  working: boolean;
  relayCandidates: number;
  error?: string;
  latency: number;
}

/**
 * Test a single TURN server for connectivity
 * Requirements: 5.5 - Lifecycle gate enforcement for TURN testing
 */
export async function testTURNServer(
  urls: string | string[],
  username: string,
  credential: string,
  timeout: number = 15000
): Promise<TURNTestResult> {
  const serverUrl = Array.isArray(urls) ? urls[0] : urls;
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    let relayCandidates = 0;
    let resolved = false;
    
    // Direct RTCPeerConnection creation is acceptable here since this is for TURN server testing
    // before any actual WebRTC connection is established
    const testPeerConnection = new RTCPeerConnection({
      iceServers: [{
        urls,
        username,
        credential
      }],
      iceTransportPolicy: 'relay' // Force TURN usage
    });

    // Use lifecycle gate enforcement for timeout
    import('./webrtc-manager').then(({ registerTimeout, enforceTimeoutCreationGate }) => {
      // Check lifecycle gate enforcement first
      if (enforceTimeoutCreationGate()) {
        console.log('⏭️ TURN test timeout blocked by lifecycle gate - connection already established');
        // If timeout creation is blocked, resolve immediately with failure
        if (!resolved) {
          resolved = true;
          testPeerConnection.close();
          resolve({
            server: serverUrl,
            working: false,
            relayCandidates: 0,
            error: 'Test blocked - connection already established',
            latency: Date.now() - startTime
          });
        }
        return;
      }
      
      const timeoutHandle = registerTimeout(() => {
        if (!resolved) {
          resolved = true;
          testPeerConnection.close();
          resolve({
            server: serverUrl,
            working: false,
            relayCandidates: 0,
            error: 'Timeout - no relay candidates found',
            latency: Date.now() - startTime
          });
        }
      }, timeout, `TURN server test timeout (${serverUrl})`);
      
      if (!timeoutHandle) {
        console.log('⏭️ TURN test timeout blocked - connection already established');
        // If timeout is blocked, resolve immediately with failure
        if (!resolved) {
          resolved = true;
          testPeerConnection.close();
          resolve({
            server: serverUrl,
            working: false,
            relayCandidates: 0,
            error: 'Test blocked - connection already established',
            latency: Date.now() - startTime
          });
        }
      }
    }).catch(() => {
      // Fallback if import fails - use direct setTimeout for TURN server testing
      // This is acceptable since TURN testing happens before connection establishment
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          testPeerConnection.close();
          resolve({
            server: serverUrl,
            working: false,
            relayCandidates: 0,
            error: 'Timeout - no relay candidates found',
            latency: Date.now() - startTime
          });
        }
      }, timeout);
    });

    testPeerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`TURN test candidate: ${event.candidate.type} - ${event.candidate.address}:${event.candidate.port}`);
        
        if (event.candidate.type === 'relay') {
          relayCandidates++;
          
          if (!resolved) {
            resolved = true;
            // Note: We can't clear the registered timeout directly, but it will be cleaned up by the lifecycle system
            testPeerConnection.close();
            resolve({
              server: serverUrl,
              working: true,
              relayCandidates,
              latency: Date.now() - startTime
            });
          }
        }
      } else {
        // ICE gathering complete
        if (!resolved) {
          resolved = true;
          // Note: We can't clear the registered timeout directly, but it will be cleaned up by the lifecycle system
          testPeerConnection.close();
          resolve({
            server: serverUrl,
            working: relayCandidates > 0,
            relayCandidates,
            error: relayCandidates === 0 ? 'No relay candidates found' : undefined,
            latency: Date.now() - startTime
          });
        }
      }
    };

    testPeerConnection.onicegatheringstatechange = () => {
      console.log(`TURN test ICE gathering state: ${testPeerConnection.iceGatheringState}`);
    };

    // Create a dummy data channel to trigger ICE gathering
    const dataChannel = testPeerConnection.createDataChannel('test');
    
    testPeerConnection.createOffer().then(offer => {
      return testPeerConnection.setLocalDescription(offer);
    }).catch(error => {
      if (!resolved) {
        resolved = true;
        // Note: We can't clear the registered timeout directly, but it will be cleaned up by the lifecycle system
        testPeerConnection.close();
        resolve({
          server: serverUrl,
          working: false,
          relayCandidates: 0,
          error: `Failed to create offer: ${error.message}`,
          latency: Date.now() - startTime
        });
      }
    });
  });
}

/**
 * Test all configured TURN servers
 */
export async function testAllTURNServers(): Promise<TURNTestResult[]> {
  const results: TURNTestResult[] = [];
  
  // Test free TURN servers
  const freeTurnServers = [
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp'
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:relay1.expressturn.com:3478',
      username: 'efJBIBF6DKC8QBA6XB',
      credential: 'Ghq6EzYyZJQcZnOh'
    }
  ];
  
  // Test production TURN servers if configured
  const productionServers = [];
  
  // Metered.ca
  if (process.env.NEXT_PUBLIC_METERED_TURN_USERNAME && process.env.NEXT_PUBLIC_METERED_TURN_CREDENTIAL) {
    productionServers.push({
      urls: [
        'turn:a.relay.metered.ca:80',
        'turn:a.relay.metered.ca:80?transport=tcp',
        'turn:a.relay.metered.ca:443',
        'turn:a.relay.metered.ca:443?transport=tcp',
        'turns:a.relay.metered.ca:443?transport=tcp'
      ],
      username: process.env.NEXT_PUBLIC_METERED_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_METERED_TURN_CREDENTIAL
    });
  }
  
  // Twilio
  if (process.env.NEXT_PUBLIC_TWILIO_TURN_USERNAME && process.env.NEXT_PUBLIC_TWILIO_TURN_CREDENTIAL) {
    productionServers.push({
      urls: [
        'turn:global.turn.twilio.com:3478?transport=udp',
        'turn:global.turn.twilio.com:3478?transport=tcp',
        'turn:global.turn.twilio.com:443?transport=tcp'
      ],
      username: process.env.NEXT_PUBLIC_TWILIO_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TWILIO_TURN_CREDENTIAL
    });
  }
  
  // Custom TURN server
  if (process.env.NEXT_PUBLIC_TURN_SERVER && 
      process.env.NEXT_PUBLIC_TURN_USERNAME && 
      process.env.NEXT_PUBLIC_TURN_CREDENTIAL) {
    productionServers.push({
      urls: [
        `turn:${process.env.NEXT_PUBLIC_TURN_SERVER}:3478`,
        `turns:${process.env.NEXT_PUBLIC_TURN_SERVER}:5349`,
        `turn:${process.env.NEXT_PUBLIC_TURN_SERVER}:80?transport=tcp`,
        `turn:${process.env.NEXT_PUBLIC_TURN_SERVER}:443?transport=tcp`
      ],
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL
    });
  }
  
  const allServers = process.env.NODE_ENV === 'production' ? productionServers : [...productionServers, ...freeTurnServers];
  
  console.log(`Testing ${allServers.length} TURN servers...`);
  
  // Test servers in parallel
  const testPromises = allServers.map(server => 
    testTURNServer(server.urls, server.username, server.credential)
  );
  
  const testResults = await Promise.all(testPromises);
  results.push(...testResults);
  
  // Log results
  console.log('TURN Server Test Results:');
  results.forEach(result => {
    const status = result.working ? '✅ WORKING' : '❌ FAILED';
    console.log(`${status} ${result.server} (${result.latency}ms, ${result.relayCandidates} relay candidates)`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });
  
  const workingServers = results.filter(r => r.working).length;
  console.log(`\nSummary: ${workingServers}/${results.length} TURN servers working`);
  
  if (workingServers === 0) {
    console.error('❌ CRITICAL: No TURN servers are working!');
    console.error('This will cause connection failures in restrictive networks.');
    console.error('Please check your TURN server configuration.');
  }
  
  return results;
}

/**
 * Quick TURN connectivity check
 */
export async function quickTURNCheck(): Promise<boolean> {
  try {
    const results = await testAllTURNServers();
    return results.some(result => result.working);
  } catch (error) {
    console.error('TURN connectivity check failed:', error);
    return false;
  }
}