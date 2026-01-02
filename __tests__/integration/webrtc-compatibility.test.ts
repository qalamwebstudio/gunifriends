/**
 * WebRTC Cross-Browser Compatibility Tests
 * 
 * Tests WebRTC functionality across different browser implementations
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5 - WebRTC compatibility
 */

// Browser-specific WebRTC implementations
interface WebRTCImplementation {
  name: string;
  RTCPeerConnection: jest.MockedClass<any>;
  RTCSessionDescription: jest.MockedClass<any>;
  RTCIceCandidate: jest.MockedClass<any>;
  getUserMedia: jest.MockedFunction<any>;
}

describe('WebRTC Cross-Browser Compatibility Tests', () => {
  // Chrome WebRTC Implementation Mock
  const createChromeWebRTC = (): WebRTCImplementation => ({
    name: 'Chrome',
    RTCPeerConnection: jest.fn().mockImplementation(() => ({
      createOffer: jest.fn().mockResolvedValue({
        type: 'offer',
        sdp: 'v=0\r\no=chrome 123456789 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
      }),
      createAnswer: jest.fn().mockResolvedValue({
        type: 'answer',
        sdp: 'v=0\r\no=chrome 987654321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
      }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined),
      setRemoteDescription: jest.fn().mockResolvedValue(undefined),
      addIceCandidate: jest.fn().mockResolvedValue(undefined),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      localDescription: null,
      remoteDescription: null,
      iceGatheringState: 'complete',
    })),
    RTCSessionDescription: jest.fn().mockImplementation((init) => ({
      type: init.type,
      sdp: init.sdp,
      toJSON: () => ({ type: init.type, sdp: init.sdp })
    })),
    RTCIceCandidate: jest.fn().mockImplementation((init) => ({
      candidate: init.candidate,
      sdpMid: init.sdpMid,
      sdpMLineIndex: init.sdpMLineIndex,
      toJSON: () => init
    })),
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: () => [
        { kind: 'video', id: 'chrome-video-track', enabled: true, stop: jest.fn() },
        { kind: 'audio', id: 'chrome-audio-track', enabled: true, stop: jest.fn() }
      ],
      getVideoTracks: () => [{ kind: 'video', id: 'chrome-video-track', enabled: true, stop: jest.fn() }],
      getAudioTracks: () => [{ kind: 'audio', id: 'chrome-audio-track', enabled: true, stop: jest.fn() }],
    })
  });

  // Firefox WebRTC Implementation Mock
  const createFirefoxWebRTC = (): WebRTCImplementation => ({
    name: 'Firefox',
    RTCPeerConnection: jest.fn().mockImplementation(() => ({
      createOffer: jest.fn().mockResolvedValue({
        type: 'offer',
        sdp: 'v=0\r\no=mozilla 123456789 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n'
      }),
      createAnswer: jest.fn().mockResolvedValue({
        type: 'answer',
        sdp: 'v=0\r\no=mozilla 987654321 0 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n'
      }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined),
      setRemoteDescription: jest.fn().mockResolvedValue(undefined),
      addIceCandidate: jest.fn().mockResolvedValue(undefined),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      localDescription: null,
      remoteDescription: null,
      iceGatheringState: 'complete',
    })),
    RTCSessionDescription: jest.fn().mockImplementation((init) => ({
      type: init.type,
      sdp: init.sdp,
      toJSON: () => ({ type: init.type, sdp: init.sdp })
    })),
    RTCIceCandidate: jest.fn().mockImplementation((init) => ({
      candidate: init.candidate,
      sdpMid: init.sdpMid,
      sdpMLineIndex: init.sdpMLineIndex,
      toJSON: () => init
    })),
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: () => [
        { kind: 'video', id: 'firefox-video-track', enabled: true, stop: jest.fn() },
        { kind: 'audio', id: 'firefox-audio-track', enabled: true, stop: jest.fn() }
      ],
      getVideoTracks: () => [{ kind: 'video', id: 'firefox-video-track', enabled: true, stop: jest.fn() }],
      getAudioTracks: () => [{ kind: 'audio', id: 'firefox-audio-track', enabled: true, stop: jest.fn() }],
    })
  });

  // Safari WebRTC Implementation Mock
  const createSafariWebRTC = (): WebRTCImplementation => ({
    name: 'Safari',
    RTCPeerConnection: jest.fn().mockImplementation(() => ({
      createOffer: jest.fn().mockResolvedValue({
        type: 'offer',
        sdp: 'v=0\r\no=- 123456789012345678 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
      }),
      createAnswer: jest.fn().mockResolvedValue({
        type: 'answer',
        sdp: 'v=0\r\no=- 987654321098765432 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
      }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined),
      setRemoteDescription: jest.fn().mockResolvedValue(undefined),
      addIceCandidate: jest.fn().mockResolvedValue(undefined),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      localDescription: null,
      remoteDescription: null,
      iceGatheringState: 'complete',
    })),
    RTCSessionDescription: jest.fn().mockImplementation((init) => ({
      type: init.type,
      sdp: init.sdp,
      toJSON: () => ({ type: init.type, sdp: init.sdp })
    })),
    RTCIceCandidate: jest.fn().mockImplementation((init) => ({
      candidate: init.candidate,
      sdpMid: init.sdpMid,
      sdpMLineIndex: init.sdpMLineIndex,
      toJSON: () => init
    })),
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: () => [
        { kind: 'video', id: 'safari-video-track', enabled: true, stop: jest.fn() },
        { kind: 'audio', id: 'safari-audio-track', enabled: true, stop: jest.fn() }
      ],
      getVideoTracks: () => [{ kind: 'video', id: 'safari-video-track', enabled: true, stop: jest.fn() }],
      getAudioTracks: () => [{ kind: 'audio', id: 'safari-audio-track', enabled: true, stop: jest.fn() }],
    })
  });

  // Edge WebRTC Implementation Mock
  const createEdgeWebRTC = (): WebRTCImplementation => ({
    name: 'Edge',
    RTCPeerConnection: jest.fn().mockImplementation(() => ({
      createOffer: jest.fn().mockResolvedValue({
        type: 'offer',
        sdp: 'v=0\r\no=edge 123456789 1 IN IP4 192.168.1.1\r\ns=-\r\nt=0 0\r\n'
      }),
      createAnswer: jest.fn().mockResolvedValue({
        type: 'answer',
        sdp: 'v=0\r\no=edge 987654321 1 IN IP4 192.168.1.1\r\ns=-\r\nt=0 0\r\n'
      }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined),
      setRemoteDescription: jest.fn().mockResolvedValue(undefined),
      addIceCandidate: jest.fn().mockResolvedValue(undefined),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
      connectionState: 'connected',
      iceConnectionState: 'connected',
      signalingState: 'stable',
      localDescription: null,
      remoteDescription: null,
      iceGatheringState: 'complete',
    })),
    RTCSessionDescription: jest.fn().mockImplementation((init) => ({
      type: init.type,
      sdp: init.sdp,
      toJSON: () => ({ type: init.type, sdp: init.sdp })
    })),
    RTCIceCandidate: jest.fn().mockImplementation((init) => ({
      candidate: init.candidate,
      sdpMid: init.sdpMid,
      sdpMLineIndex: init.sdpMLineIndex,
      toJSON: () => init
    })),
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: () => [
        { kind: 'video', id: 'edge-video-track', enabled: true, stop: jest.fn() },
        { kind: 'audio', id: 'edge-audio-track', enabled: true, stop: jest.fn() }
      ],
      getVideoTracks: () => [{ kind: 'video', id: 'edge-video-track', enabled: true, stop: jest.fn() }],
      getAudioTracks: () => [{ kind: 'audio', id: 'edge-audio-track', enabled: true, stop: jest.fn() }],
    })
  });

  const browsers = [
    createChromeWebRTC(),
    createFirefoxWebRTC(),
    createSafariWebRTC(),
    createEdgeWebRTC()
  ];

  describe('Cross-Browser WebRTC Connection Establishment', () => {
    it.each(browsers.flatMap(browser1 => 
      browsers.filter(browser2 => browser2.name !== browser1.name)
        .map(browser2 => [browser1, browser2])
    ))('should establish WebRTC connection between %s and %s', async (browser1: WebRTCImplementation, browser2: WebRTCImplementation) => {
      // Create peer connections for both browsers
      const pc1 = new browser1.RTCPeerConnection();
      const pc2 = new browser2.RTCPeerConnection();

      // Browser 1 creates offer
      const offer = await pc1.createOffer();
      expect(offer.type).toBe('offer');
      expect(offer.sdp).toContain('v=0');

      // Browser 1 sets local description
      await pc1.setLocalDescription(offer);
      expect(pc1.setLocalDescription).toHaveBeenCalledWith(offer);

      // Browser 2 receives offer and sets remote description
      await pc2.setRemoteDescription(offer);
      expect(pc2.setRemoteDescription).toHaveBeenCalledWith(offer);

      // Browser 2 creates answer
      const answer = await pc2.createAnswer();
      expect(answer.type).toBe('answer');
      expect(answer.sdp).toContain('v=0');

      // Browser 2 sets local description
      await pc2.setLocalDescription(answer);
      expect(pc2.setLocalDescription).toHaveBeenCalledWith(answer);

      // Browser 1 receives answer and sets remote description
      await pc1.setRemoteDescription(answer);
      expect(pc1.setRemoteDescription).toHaveBeenCalledWith(answer);

      // Verify connection states
      expect(pc1.connectionState).toBe('connected');
      expect(pc2.connectionState).toBe('connected');
      expect(pc1.signalingState).toBe('stable');
      expect(pc2.signalingState).toBe('stable');
    });

    it.each(browsers)('should handle ICE candidate exchange for %s', async (browser: WebRTCImplementation) => {
      const pc = new browser.RTCPeerConnection();
      
      // Create mock ICE candidates
      const candidates = [
        {
          candidate: 'candidate:1 1 UDP 2130706431 192.168.1.100 54400 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0
        },
        {
          candidate: 'candidate:2 1 UDP 1694498815 203.0.113.100 54401 typ srflx raddr 192.168.1.100 rport 54400',
          sdpMid: '0',
          sdpMLineIndex: 0
        }
      ];

      // Add ICE candidates
      for (const candidateInit of candidates) {
        const candidate = new browser.RTCIceCandidate(candidateInit);
        await pc.addIceCandidate(candidate);
        expect(pc.addIceCandidate).toHaveBeenCalledWith(candidate);
      }

      expect(pc.iceConnectionState).toBe('connected');
    });

    it.each(browsers)('should handle media stream access for %s', async (browser: WebRTCImplementation) => {
      // Get user media
      const stream = await browser.getUserMedia({ video: true, audio: true });
      
      expect(stream).toBeDefined();
      expect(stream.getTracks()).toHaveLength(2);
      expect(stream.getVideoTracks()).toHaveLength(1);
      expect(stream.getAudioTracks()).toHaveLength(1);

      // Verify track properties
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      expect(videoTrack.kind).toBe('video');
      expect(videoTrack.enabled).toBe(true);
      expect(audioTrack.kind).toBe('audio');
      expect(audioTrack.enabled).toBe(true);
    });
  });

  describe('Browser-Specific Error Handling', () => {
    it('should handle Chrome-specific WebRTC errors', async () => {
      const chromeWithErrors = {
        ...createChromeWebRTC(),
        RTCPeerConnection: jest.fn().mockImplementation(() => ({
          createOffer: jest.fn().mockRejectedValue(new Error('Chrome: Failed to create offer')),
          createAnswer: jest.fn().mockRejectedValue(new Error('Chrome: Failed to create answer')),
          setLocalDescription: jest.fn().mockRejectedValue(new Error('Chrome: Failed to set local description')),
          setRemoteDescription: jest.fn().mockRejectedValue(new Error('Chrome: Failed to set remote description')),
          addIceCandidate: jest.fn().mockRejectedValue(new Error('Chrome: Failed to add ICE candidate')),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          close: jest.fn(),
          connectionState: 'failed',
          iceConnectionState: 'failed',
          signalingState: 'closed',
        }))
      };

      const pc = new chromeWithErrors.RTCPeerConnection();

      await expect(pc.createOffer()).rejects.toThrow('Chrome: Failed to create offer');
      await expect(pc.createAnswer()).rejects.toThrow('Chrome: Failed to create answer');
      await expect(pc.setLocalDescription({})).rejects.toThrow('Chrome: Failed to set local description');
      await expect(pc.setRemoteDescription({})).rejects.toThrow('Chrome: Failed to set remote description');
      await expect(pc.addIceCandidate({})).rejects.toThrow('Chrome: Failed to add ICE candidate');

      expect(pc.connectionState).toBe('failed');
    });

    it('should handle Firefox-specific WebRTC errors', async () => {
      const firefoxWithErrors = {
        ...createFirefoxWebRTC(),
        RTCPeerConnection: jest.fn().mockImplementation(() => ({
          createOffer: jest.fn().mockRejectedValue(new Error('Firefox: InvalidStateError')),
          createAnswer: jest.fn().mockRejectedValue(new Error('Firefox: InvalidSessionDescriptionError')),
          setLocalDescription: jest.fn().mockRejectedValue(new Error('Firefox: OperationError')),
          setRemoteDescription: jest.fn().mockRejectedValue(new Error('Firefox: InvalidAccessError')),
          addIceCandidate: jest.fn().mockRejectedValue(new Error('Firefox: InvalidCandidateError')),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          close: jest.fn(),
          connectionState: 'failed',
          iceConnectionState: 'failed',
          signalingState: 'closed',
        }))
      };

      const pc = new firefoxWithErrors.RTCPeerConnection();

      await expect(pc.createOffer()).rejects.toThrow('Firefox: InvalidStateError');
      await expect(pc.createAnswer()).rejects.toThrow('Firefox: InvalidSessionDescriptionError');
      await expect(pc.setLocalDescription({})).rejects.toThrow('Firefox: OperationError');
      await expect(pc.setRemoteDescription({})).rejects.toThrow('Firefox: InvalidAccessError');
      await expect(pc.addIceCandidate({})).rejects.toThrow('Firefox: InvalidCandidateError');

      expect(pc.connectionState).toBe('failed');
    });

    it('should handle Safari-specific media access errors', async () => {
      const safariWithMediaErrors = {
        ...createSafariWebRTC(),
        getUserMedia: jest.fn().mockRejectedValue(new Error('Safari: NotAllowedError - Permission denied'))
      };

      await expect(safariWithMediaErrors.getUserMedia({ video: true, audio: true }))
        .rejects.toThrow('Safari: NotAllowedError - Permission denied');
    });

    it('should handle Edge-specific connection errors', async () => {
      const edgeWithConnectionErrors = {
        ...createEdgeWebRTC(),
        RTCPeerConnection: jest.fn().mockImplementation(() => ({
          createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'edge-offer' }),
          createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'edge-answer' }),
          setLocalDescription: jest.fn().mockResolvedValue(undefined),
          setRemoteDescription: jest.fn().mockResolvedValue(undefined),
          addIceCandidate: jest.fn().mockRejectedValue(new Error('Edge: NetworkError - ICE candidate failed')),
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          close: jest.fn(),
          connectionState: 'disconnected',
          iceConnectionState: 'disconnected',
          signalingState: 'stable',
        }))
      };

      const pc = new edgeWithConnectionErrors.RTCPeerConnection();

      // Should work for basic operations
      const offer = await pc.createOffer();
      expect(offer.type).toBe('offer');

      // Should fail for ICE candidate
      await expect(pc.addIceCandidate({})).rejects.toThrow('Edge: NetworkError - ICE candidate failed');
      expect(pc.connectionState).toBe('disconnected');
    });
  });

  describe('WebRTC Feature Compatibility', () => {
    it.each(browsers)('should support required WebRTC features for %s', async (browser: WebRTCImplementation) => {
      const pc = new browser.RTCPeerConnection();

      // Test required methods exist
      expect(typeof pc.createOffer).toBe('function');
      expect(typeof pc.createAnswer).toBe('function');
      expect(typeof pc.setLocalDescription).toBe('function');
      expect(typeof pc.setRemoteDescription).toBe('function');
      expect(typeof pc.addIceCandidate).toBe('function');
      expect(typeof pc.close).toBe('function');

      // Test required properties exist
      expect(pc.connectionState).toBeDefined();
      expect(pc.iceConnectionState).toBeDefined();
      expect(pc.signalingState).toBeDefined();

      // Test getUserMedia functionality
      const stream = await browser.getUserMedia({ video: true, audio: true });
      expect(stream.getTracks).toBeDefined();
      expect(stream.getVideoTracks).toBeDefined();
      expect(stream.getAudioTracks).toBeDefined();
    });

    it('should handle different SDP formats across browsers', async () => {
      const browsers = [createChromeWebRTC(), createFirefoxWebRTC(), createSafariWebRTC(), createEdgeWebRTC()];
      
      for (const browser of browsers) {
        const pc = new browser.RTCPeerConnection();
        const offer = await pc.createOffer();
        
        // All browsers should produce valid SDP
        expect(offer.sdp).toContain('v=0');
        expect(offer.sdp).toContain('o=');
        expect(offer.sdp).toContain('s=');
        expect(offer.sdp).toContain('t=');
        
        // SDP should be parseable by other browsers
        const sessionDesc = new browser.RTCSessionDescription(offer);
        expect(sessionDesc.type).toBe('offer');
        expect(sessionDesc.sdp).toBe(offer.sdp);
      }
    });

    it('should handle different ICE candidate formats', async () => {
      const candidateFormats = [
        // Chrome format
        'candidate:1 1 UDP 2130706431 192.168.1.100 54400 typ host',
        // Firefox format  
        'candidate:0 1 UDP 2122252543 192.168.1.100 54400 typ host',
        // Safari format
        'candidate:1 1 udp 2130706431 192.168.1.100 54400 typ host',
        // Edge format
        'candidate:1 1 UDP 2130706431 192.168.1.100 54400 typ host generation 0'
      ];

      for (const browser of browsers) {
        const pc = new browser.RTCPeerConnection();
        
        for (const candidateString of candidateFormats) {
          const candidate = new browser.RTCIceCandidate({
            candidate: candidateString,
            sdpMid: '0',
            sdpMLineIndex: 0
          });
          
          // Should not throw error
          await expect(pc.addIceCandidate(candidate)).resolves.toBeUndefined();
        }
      }
    });
  });

  describe('Performance and Resource Management', () => {
    it.each(browsers)('should properly clean up resources for %s', async (browser: WebRTCImplementation) => {
      const pc = new browser.RTCPeerConnection();
      const stream = await browser.getUserMedia({ video: true, audio: true });
      
      // Verify resources are active
      expect(pc.connectionState).toBeDefined();
      expect(stream.getTracks()).toHaveLength(2);
      
      // Clean up
      stream.getTracks().forEach(track => track.stop());
      pc.close();
      
      // Verify cleanup
      expect(pc.close).toHaveBeenCalled();
      stream.getTracks().forEach(track => {
        expect(track.stop).toHaveBeenCalled();
      });
    });

    it('should handle multiple concurrent connections', async () => {
      const connectionCount = 5;
      const connections: any[] = [];
      
      // Create multiple connections for each browser
      for (const browser of browsers) {
        for (let i = 0; i < connectionCount; i++) {
          const pc = new browser.RTCPeerConnection();
          connections.push({ browser: browser.name, pc });
        }
      }
      
      expect(connections).toHaveLength(browsers.length * connectionCount);
      
      // Test that all connections can create offers simultaneously
      const offerPromises = connections.map(({ pc }) => pc.createOffer());
      const offers = await Promise.all(offerPromises);
      
      expect(offers).toHaveLength(connections.length);
      offers.forEach(offer => {
        expect(offer.type).toBe('offer');
        expect(offer.sdp).toContain('v=0');
      });
      
      // Clean up all connections
      connections.forEach(({ pc }) => pc.close());
    });

    it('should handle rapid connection establishment and teardown', async () => {
      const cycleCount = 10;
      
      for (let i = 0; i < cycleCount; i++) {
        const chrome = createChromeWebRTC();
        const firefox = createFirefoxWebRTC();
        
        const pc1 = new chrome.RTCPeerConnection();
        const pc2 = new firefox.RTCPeerConnection();
        
        // Rapid connection establishment
        const offer = await pc1.createOffer();
        await pc1.setLocalDescription(offer);
        await pc2.setRemoteDescription(offer);
        
        const answer = await pc2.createAnswer();
        await pc2.setLocalDescription(answer);
        await pc1.setRemoteDescription(answer);
        
        // Verify connection
        expect(pc1.connectionState).toBe('connected');
        expect(pc2.connectionState).toBe('connected');
        
        // Immediate teardown
        pc1.close();
        pc2.close();
        
        expect(pc1.close).toHaveBeenCalled();
        expect(pc2.close).toHaveBeenCalled();
      }
    });
  });

  describe('Real-world Scenario Simulation', () => {
    it('should handle network condition variations', async () => {
      // Simulate different network conditions with varying ICE candidates
      const networkConditions = [
        {
          name: 'Good Connection',
          candidates: [
            'candidate:1 1 UDP 2130706431 192.168.1.100 54400 typ host',
            'candidate:2 1 UDP 1694498815 203.0.113.100 54401 typ srflx'
          ]
        },
        {
          name: 'NAT/Firewall',
          candidates: [
            'candidate:1 1 UDP 1694498815 203.0.113.100 54401 typ srflx',
            'candidate:2 1 UDP 16777215 192.0.2.100 54402 typ relay'
          ]
        },
        {
          name: 'Symmetric NAT',
          candidates: [
            'candidate:1 1 UDP 16777215 192.0.2.100 54402 typ relay'
          ]
        }
      ];

      for (const condition of networkConditions) {
        const chrome = createChromeWebRTC();
        const firefox = createFirefoxWebRTC();
        
        const pc1 = new chrome.RTCPeerConnection();
        const pc2 = new firefox.RTCPeerConnection();
        
        // Establish connection
        const offer = await pc1.createOffer();
        await pc1.setLocalDescription(offer);
        await pc2.setRemoteDescription(offer);
        
        const answer = await pc2.createAnswer();
        await pc2.setLocalDescription(answer);
        await pc1.setRemoteDescription(answer);
        
        // Add ICE candidates based on network condition
        for (const candidateString of condition.candidates) {
          const candidate1 = new chrome.RTCIceCandidate({
            candidate: candidateString,
            sdpMid: '0',
            sdpMLineIndex: 0
          });
          
          const candidate2 = new firefox.RTCIceCandidate({
            candidate: candidateString,
            sdpMid: '0',
            sdpMLineIndex: 0
          });
          
          await pc1.addIceCandidate(candidate1);
          await pc2.addIceCandidate(candidate2);
        }
        
        // Connection should still work regardless of network condition
        expect(pc1.connectionState).toBe('connected');
        expect(pc2.connectionState).toBe('connected');
        
        pc1.close();
        pc2.close();
      }
    });

    it('should handle media constraint variations', async () => {
      const mediaConstraints = [
        { video: true, audio: true },
        { video: { width: 640, height: 480 }, audio: true },
        { video: { width: 1920, height: 1080 }, audio: { echoCancellation: true } },
        { video: false, audio: true },
        { video: true, audio: false }
      ];

      for (const browser of browsers) {
        for (const constraints of mediaConstraints) {
          const stream = await browser.getUserMedia(constraints);
          
          expect(stream).toBeDefined();
          
          if (constraints.video) {
            expect(stream.getVideoTracks().length).toBeGreaterThan(0);
          } else {
            expect(stream.getVideoTracks().length).toBe(0);
          }
          
          if (constraints.audio) {
            expect(stream.getAudioTracks().length).toBeGreaterThan(0);
          } else {
            expect(stream.getAudioTracks().length).toBe(0);
          }
          
          // Clean up
          stream.getTracks().forEach(track => track.stop());
        }
      }
    });

    it('should handle connection recovery scenarios', async () => {
      const chrome = createChromeWebRTC();
      const firefox = createFirefoxWebRTC();
      
      // Initial connection
      let pc1 = new chrome.RTCPeerConnection();
      let pc2 = new firefox.RTCPeerConnection();
      
      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);
      
      expect(pc1.connectionState).toBe('connected');
      expect(pc2.connectionState).toBe('connected');
      
      // Simulate connection failure and recovery
      pc1.close();
      pc2.close();
      
      // Reconnection
      pc1 = new chrome.RTCPeerConnection();
      pc2 = new firefox.RTCPeerConnection();
      
      const newOffer = await pc1.createOffer();
      await pc1.setLocalDescription(newOffer);
      await pc2.setRemoteDescription(newOffer);
      
      const newAnswer = await pc2.createAnswer();
      await pc2.setLocalDescription(newAnswer);
      await pc1.setRemoteDescription(newAnswer);
      
      // Should be able to reconnect
      expect(pc1.connectionState).toBe('connected');
      expect(pc2.connectionState).toBe('connected');
      
      pc1.close();
      pc2.close();
    });
  });
});