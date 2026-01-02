// Debug script to test registration API
// Run with: node debug-registration.js

const https = require('https');
const http = require('http');

const testData = {
  email: "test@gnu.ac.in",
  password: "Password123",
  university: "Ganpat University"
};

// Test both local and production
const endpoints = [
  {
    name: "Local",
    url: "http://localhost:3000/api/debug/register",
    module: http
  },
  {
    name: "Production",
    url: "https://gunifriends.vercel.app/api/debug/register", 
    module: https
  }
];

async function testEndpoint(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint.url);
    const postData = JSON.stringify(testData);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = endpoint.module.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({
            status: res.statusCode,
            response: response
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            response: data
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing Registration API...\n');
  
  for (const endpoint of endpoints) {
    console.log(`📡 Testing ${endpoint.name}: ${endpoint.url}`);
    
    try {
      const result = await testEndpoint(endpoint);
      console.log(`✅ Status: ${result.status}`);
      console.log(`📄 Response:`, JSON.stringify(result.response, null, 2));
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
  }
}

runTests().catch(console.error);