import mongoose from 'mongoose';

const connectDB = async () => {
  // Validate MONGO_URI is configured
  if (!process.env.MONGO_URI) {
    console.error('❌ MongoDB URI not configured. Please set MONGO_URI in .env.local');
    process.exit(1);
  }

  // Get MONGO_URI from environment (must be defined at this point)
  let mongoURI = process.env.MONGO_URI;
  
  if (!mongoURI) {
    console.error('❌ MONGO_URI is not defined. Check .env.local file.');
    process.exit(1);
  }
  
  // Fix common mistake: Remove "MONGO_URI=" prefix if accidentally included
  if (mongoURI.startsWith('MONGO_URI=')) {
    console.warn('⚠️  Detected "MONGO_URI=" prefix in environment variable');
    console.warn('   This usually means .env.local has: MONGO_URI=MONGO_URI=...');
    console.warn('   Fixing automatically...');
    mongoURI = mongoURI.replace(/^MONGO_URI=/, '');
  }
  
  // CRITICAL FIX: Remove all whitespace and newlines (common issue with multi-line URIs)
  const originalURI = mongoURI;
  mongoURI = mongoURI.replace(/\s+/g, ''); // Remove all whitespace including newlines
  
  if (originalURI !== mongoURI) {
    console.warn('⚠️  Detected whitespace/newlines in MONGO_URI - cleaned automatically');
    console.warn('   💡 Tip: Keep MONGO_URI on a single line in .env.local');
  }
  
  // Validate URI format
  if (!mongoURI.startsWith('mongodb://') && !mongoURI.startsWith('mongodb+srv://')) {
    console.error('❌ Invalid MongoDB URI format. Must start with mongodb:// or mongodb+srv://');
    console.error(`   Current value starts with: ${mongoURI.substring(0, 30)}...`);
    console.error('\n💡 Common fix: Check your .env.local file:');
    console.error('   ❌ Wrong: MONGO_URI=MONGO_URI=mongodb://...');
    console.error('   ✅ Correct: MONGO_URI=mongodb://... (on single line)');
    process.exit(1);
  }
  
  // Parse URI to check for common issues (without exposing credentials)
  const isAtlas = mongoURI.startsWith('mongodb+srv://');
  const isLocalhost = mongoURI.includes('localhost') || mongoURI.includes('127.0.0.1');
  
  // Validate URI structure (after cleaning whitespace)
  try {
    const url = new URL(mongoURI);
    
    // For Atlas connections, username/password are required
    if (isAtlas && (!url.username || !url.password)) {
      console.error('❌ MongoDB Atlas URI missing username or password');
      console.error('Format should be: mongodb+srv://username:password@cluster.mongodb.net/database');
      process.exit(1);
    }
    
    // For localhost, warn if no database name is specified
    if (isLocalhost && (!url.pathname || url.pathname === '/')) {
      console.warn('⚠️  No database name specified in URI. Using default database.');
    }
    
    // Log safe connection info (no credentials)
    console.log(`🔌 Connecting to: ${url.protocol}//${url.hostname}${url.pathname ? url.pathname.split('?')[0] : ''}`);
  } catch (urlError) {
    console.error('❌ Invalid MongoDB URI format:', urlError.message);
    console.error('   💡 Ensure MONGO_URI is on a single line in .env.local (no line breaks)');
    console.error('   💡 Example: MONGO_URI=mongodb://user:pass@host1:27017,host2:27017/db?ssl=true&replicaSet=rs0&authSource=admin');
    process.exit(1);
  }

  try {
    // Connection options - optimized for MongoDB Atlas
    const options = {
      serverSelectionTimeoutMS: 10000, // Timeout after 10s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
      // Atlas requires TLS/SSL
      ssl: true,
      // Ensure authSource is respected (from URI query params)
      authSource: 'admin', // Default for Atlas, can be overridden by URI
    };
    
    // Atlas-specific options (for both SRV and standard connections)
    if (!isLocalhost) {
      options.retryWrites = true;
      options.w = 'majority';
    }
    
    // Connect using mongoose (handles both SRV and standard URIs)
    await mongoose.connect(mongoURI, options);
    
    // Display connection info
    const connectionType = isLocalhost ? 'Local MongoDB' : isAtlas ? 'MongoDB Atlas' : 'MongoDB';
    console.log(`✅ MongoDB connected successfully`);
    console.log(`📊 Connection Type: ${connectionType}`);
    console.log(`📊 Database: ${mongoose.connection.name || 'default'}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected successfully');
    });
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    
    // Provide specific guidance based on error type
    if (error.message.includes('authentication failed') || error.message.includes('bad auth')) {
      console.error('\n🔍 Authentication Error Troubleshooting:');
      console.error('1. Verify your username and password are correct');
      console.error('2. Check if special characters in password are URL-encoded:');
      console.error('   - @ → %40');
      console.error('   - : → %3A');
      console.error('   - / → %2F');
      console.error('   - # → %23');
      console.error('   - [ → %5B');
      console.error('   - ] → %5D');
      console.error('3. Ensure the database user exists and has proper permissions');
      console.error('4. For MongoDB Atlas: Check Network Access settings allow your IP');
      console.error('5. For local MongoDB: Ensure authentication is enabled if using credentials');
      console.error('6. Verify the database name in the URI is correct');
      console.error('\nExample formats:');
      console.error('  Local: mongodb://localhost:27017/satark-ai');
      console.error('  Local (with auth): mongodb://username:password@localhost:27017/satark-ai');
      console.error('  Atlas SRV: mongodb+srv://username:encodedPassword@cluster.mongodb.net/database');
      console.error('  Atlas Standard: mongodb://username:password@cluster-shard-00-00.xxxxx.mongodb.net:27017/database?ssl=true&replicaSet=Cluster0-shard-0&authSource=admin');
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo') || error.message.includes('querySrv')) {
      console.error('\n🔍 DNS/SRV Resolution Error (MongoDB Atlas):');
      console.error('  This usually means the SRV connection string cannot resolve DNS.');
      console.error('\n💡 SOLUTION: Use Standard Connection String instead of SRV:');
      console.error('  1. Go to MongoDB Atlas Dashboard → Your Cluster → Connect');
      console.error('  2. Choose "Connect your application"');
      console.error('  3. Select "Standard connection string" (NOT "SRV connection string")');
      console.error('  4. Copy the connection string');
      console.error('  5. Update MONGO_URI in .env.local with the standard format');
      console.error('\n  Standard format example:');
      console.error('  mongodb://username:password@cluster-shard-00-00.xxxxx.mongodb.net:27017/database?ssl=true&replicaSet=Cluster0-shard-0&authSource=admin');
      
      if (isLocalhost) {
        console.error('\n  For local MongoDB:');
        console.error('  - Ensure MongoDB is running locally: mongod or brew services start mongodb-community');
        console.error('  - Check if MongoDB is listening on the correct port (default: 27017)');
      }
    } else if (error.message.includes('timeout')) {
      console.error('\n🔍 Timeout Error:');
      if (isLocalhost) {
        console.error('  - Ensure MongoDB service is running');
        console.error('  - Check if MongoDB is accessible on the specified port');
      } else {
        console.error('  - Check Network Access settings in MongoDB Atlas');
        console.error('  - Ensure your IP is whitelisted in Atlas Network Access');
      }
    } else if (error.message.includes('ECONNREFUSED')) {
      console.error('\n🔍 Connection Refused Error:');
      console.error('  - Ensure MongoDB is running: mongod or brew services start mongodb-community');
      console.error('  - Check if MongoDB is listening on the correct port (default: 27017)');
      console.error('  - Verify the connection string matches your MongoDB configuration');
    }
    
    console.error('\n📝 Current MONGO_URI format:', isAtlas ? 'mongodb+srv:// (SRV)' : 'mongodb:// (Standard)');
    console.error('📁 Please check your MONGO_URI in AI/server/.env.local');
    process.exit(1);
  }
};

export default connectDB;

