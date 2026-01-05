# WebRTC Network Traversal Setup Guide

This guide explains how to configure TURN servers and optimize WebRTC for restrictive networks like college, hostel, and office WiFi.

## Problem: 40-50 Second Connection Drops

**Symptoms:**
- Video calls work initially but drop after 40-50 seconds
- UI shows "Reconnecting 1/5" repeatedly
- Console shows "TURN connectivity not available"
- High network latency (~1000ms)
- More frequent on WiFi networks with restrictive NAT/firewalls

**Root Cause:**
- Initial P2P connection works via STUN servers
- NAT/firewall rules change after ~45 seconds, breaking the connection
- No TURN relay servers available to maintain connection
- Aggressive timeout settings cause premature disconnections

## Solution: Enhanced TURN Server Configuration

### 1. Production TURN Server Providers

#### Option A: Metered.ca (Recommended)
- **Cost:** $0.40 per GB of relayed traffic
- **Reliability:** High uptime, global infrastructure
- **Setup:**
  ```bash
  # Sign up at https://www.metered.ca/
  # Get credentials from dashboard
  NEXT_PUBLIC_METERED_TURN_USERNAME=your_username
  NEXT_PUBLIC_METERED_TURN_CREDENTIAL=your_credential
  ```

#### Option B: Twilio STUN/TURN
- **Cost:** $0.40 per GB + $0.0015 per minute
- **Reliability:** Enterprise-grade
- **Setup:**
  ```bash
  # Sign up at https://www.twilio.com/stun-turn
  NEXT_PUBLIC_TWILIO_TURN_USERNAME=your_username
  NEXT_PUBLIC_TWILIO_TURN_CREDENTIAL=your_credential
  ```

#### Option C: Xirsys
- **Cost:** Free tier available, paid plans from $10/month
- **Reliability:** Good for development and small scale
- **Setup:**
  ```bash
  # Sign up at https://xirsys.com/
  NEXT_PUBLIC_XIRSYS_TURN_USERNAME=your_username
  NEXT_PUBLIC_XIRSYS_TURN_CREDENTIAL=your_credential
  ```

### 2. Self-Hosted coturn Server (Advanced)

For full control and cost optimization:

#### Installation on Ubuntu/Debian:
```bash
# Install coturn
sudo apt-get update
sudo apt-get install coturn

# Enable coturn service
sudo systemctl enable coturn
```

#### Configuration (/etc/turnserver.conf):
```bash
# Basic configuration
listening-port=3478
tls-listening-port=5349
listening-ip=YOUR_SERVER_IP
external-ip=YOUR_SERVER_IP
relay-ip=YOUR_SERVER_IP

# Domain and authentication
realm=YOUR_DOMAIN
server-name=YOUR_DOMAIN
lt-cred-mech
user=campuscam:your_secure_password

# SSL certificates (required for TURNS)
cert=/path/to/ssl/cert.pem
pkey=/path/to/ssl/private.key

# Logging
no-stdout-log
log-file=/var/log/turnserver.log
verbose

# Security and performance
fingerprint
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1
```

#### Firewall Configuration:
```bash
# Allow TURN server ports
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp  # TURN relay port range

# Start the service
sudo systemctl start coturn
sudo systemctl status coturn
```

#### Environment Variables:
```bash
NEXT_PUBLIC_TURN_SERVER=your.turn.server.com
NEXT_PUBLIC_TURN_USERNAME=campuscam
NEXT_PUBLIC_TURN_CREDENTIAL=your_secure_password
```

### 3. Testing TURN Server Configuration

#### Test TURN Connectivity:
```javascript
// Use the built-in test function
import { testWebRTCConnectivity } from './app/lib/webrtc-config';

const testResults = await testWebRTCConnectivity();
console.log('Network test results:', testResults);

// Expected output for working TURN:
// {
//   hasInternet: true,
//   hasSTUN: true,
//   hasTURN: true,
//   networkType: 'open',
//   recommendedPolicy: 'all'
// }
```

#### Online TURN Server Test:
Visit: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Enter your TURN server details:
- TURN URL: `turn:your.server.com:3478`
- Username: `your_username`
- Password: `your_password`

Look for "relay" type candidates in the results.

### 4. Network Environment Detection

The system automatically detects network restrictiveness:

#### Network Types:
- **Open:** Low latency (<500ms), STUN works, minimal restrictions
- **Moderate:** Medium latency (500-1000ms), some restrictions
- **Restrictive:** High latency (>1000ms), aggressive NAT/firewall

#### Automatic Optimizations:
- **Open networks:** Use both STUN and TURN (iceTransportPolicy: 'all')
- **Restrictive networks:** Force TURN relay mode (iceTransportPolicy: 'relay')
- **Progressive timeouts:** Extend connection timeouts based on network type
- **Enhanced ICE restart:** Automatic ICE restart on connection failures

### 5. Monitoring and Debugging

#### Connection Status Indicators:
The UI shows real-time network status:
- **Network Type:** Open/Moderate/Restrictive
- **Relay Mode:** Indicates if TURN relay is forced
- **ICE Restarts:** Number of ICE restart attempts
- **Connection Quality:** Good/Fair/Poor based on packet loss

#### Console Logging:
Enable detailed WebRTC logging:
```javascript
// Check browser console for:
console.log('🌐 WebRTC configuration loaded: X ICE servers');
console.log('🔧 ICE transport policy: all/relay');
console.log('✅ X TURN servers configured for NAT traversal');
console.log('🔄 TURN relay candidate found');
```

#### Common Issues and Solutions:

**Issue:** No TURN relay candidates
```
⚠️ No TURN relay candidates found in restrictive network
```
**Solution:** Verify TURN server credentials and firewall rules

**Issue:** ICE connection fails repeatedly
```
❌ ICE connection failed permanently after multiple restart attempts
```
**Solution:** Check network restrictions, try different TURN server

**Issue:** High latency warnings
```
⚠️ High network latency detected: 1500ms
```
**Solution:** Connection will work but may have quality issues

### 6. Cost Optimization

#### Bandwidth Usage:
- **Audio only:** ~50 KB/minute
- **Video (480p):** ~2-5 MB/minute
- **Video (720p):** ~5-10 MB/minute

#### TURN Usage Patterns:
- **Direct P2P:** 0% TURN usage (ideal)
- **Symmetric NAT:** 100% TURN usage (necessary)
- **Mixed networks:** 20-40% TURN usage (typical)

#### Cost Estimation (Metered.ca):
- 1000 minutes of 720p video calls ≈ 5-10 GB
- Monthly cost: $2-4 for moderate usage
- Enterprise usage: $20-50/month for heavy traffic

### 7. Production Deployment Checklist

- [ ] Configure reliable TURN server provider
- [ ] Set up SSL certificates for TURNS
- [ ] Configure firewall rules for TURN ports
- [ ] Test TURN connectivity from target networks
- [ ] Monitor TURN usage and costs
- [ ] Set up alerts for TURN server downtime
- [ ] Configure backup TURN servers
- [ ] Test from various network environments (college WiFi, corporate networks, mobile data)

### 8. Network-Specific Recommendations

#### College/University Networks:
- Often have symmetric NAT requiring TURN relay
- May block UDP traffic, use TCP TURN servers
- Consider multiple TURN providers for redundancy

#### Corporate Networks:
- Strict firewall rules, whitelist TURN server IPs
- May require TURNS (TLS) on port 443
- Test during business hours for realistic conditions

#### Mobile Networks:
- Generally work well with STUN
- Carrier-grade NAT may require TURN
- Consider data usage implications

#### Home WiFi:
- Usually works with STUN only
- Some routers have aggressive NAT timeouts
- TURN provides backup for problematic routers

## Conclusion

Proper TURN server configuration is essential for reliable WebRTC connections in restrictive networks. The enhanced network traversal system automatically detects network conditions and applies appropriate optimizations, but requires at least one reliable TURN server to handle the most restrictive environments.

For production deployment, invest in a reliable TURN service provider rather than relying on free servers, which often have limitations and poor reliability.