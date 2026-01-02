// Simple script to check MongoDB connection and data
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function checkDatabase() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DATABASE_NAME || 'university_video_chat';

  if (!uri) {
    console.error('❌ MONGODB_URI not found in environment variables');
    return;
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB successfully');

    const db = client.db(dbName);
    
    // Check collections
    const collections = await db.listCollections().toArray();
    console.log('📁 Collections:', collections.map(c => c.name));

    // Check users
    const users = db.collection('users');
    const userCount = await users.countDocuments();
    console.log('👥 Total users:', userCount);

    if (userCount > 0) {
      const sampleUsers = await users.find({}, { 
        projection: { 
          email: 1, 
          university: 1, 
          isEmailVerified: 1, 
          createdAt: 1 
        } 
      }).limit(5).toArray();
      
      console.log('📋 Sample users:');
      sampleUsers.forEach(user => {
        console.log(`  - ${user.email} (${user.university}) - Verified: ${user.isEmailVerified}`);
      });
    }

    // Check database stats
    const stats = await db.stats();
    console.log('📊 Database stats:');
    console.log(`  - Database: ${stats.db}`);
    console.log(`  - Collections: ${stats.collections}`);
    console.log(`  - Data Size: ${(stats.dataSize / 1024).toFixed(2)} KB`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('✅ Disconnected from MongoDB');
  }
}

checkDatabase().catch(console.error);