// Environment Variables Checker
const requiredEnvVars = [
  'NEXT_PUBLIC_BASE_URL',
  'JWT_SECRET',
  'MONGODB_URI',
  'DATABASE_NAME',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS'
];

console.log('🔍 Checking Environment Variables...\n');

const missing = [];
const present = [];

requiredEnvVars.forEach(envVar => {
  if (process.env[envVar]) {
    present.push(envVar);
    console.log(`✅ ${envVar}: ${envVar.includes('PASS') || envVar.includes('SECRET') ? '[HIDDEN]' : process.env[envVar]}`);
  } else {
    missing.push(envVar);
    console.log(`❌ ${envVar}: NOT SET`);
  }
});

console.log(`\n📊 Summary:`);
console.log(`✅ Present: ${present.length}/${requiredEnvVars.length}`);
console.log(`❌ Missing: ${missing.length}/${requiredEnvVars.length}`);

if (missing.length > 0) {
  console.log(`\n🚨 Missing Environment Variables:`);
  missing.forEach(envVar => console.log(`   - ${envVar}`));
  console.log(`\n💡 Add these to your Vercel Environment Variables!`);
} else {
  console.log(`\n🎉 All environment variables are set!`);
}