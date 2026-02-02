// Load environment variables FIRST before any other imports
// This file must be imported before any other modules that use process.env
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use process.cwd() to get absolute path to .env.local
// Look for .env.local in AI/server/ directory
const serverDir = resolve(__dirname, '..');
const envLocalPath = resolve(serverDir, '.env.local');
const envPath = resolve(serverDir, '.env');

console.log('\n🔍 Loading environment variables...');
console.log(`   Server directory: ${serverDir}`);
console.log(`   Checking for .env.local: ${envLocalPath}`);

if (fs.existsSync(envLocalPath)) {
  const result = dotenv.config({ path: envLocalPath });
  if (result.error) {
    console.error('❌ ERROR loading .env.local:', result.error.message);
    process.exit(1);
  }
  console.log('✅ Loaded .env.local successfully');
  console.log(`   Path: ${envLocalPath}`);
} else if (fs.existsSync(envPath)) {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    console.error('❌ ERROR loading .env:', result.error.message);
    process.exit(1);
  }
  console.log('✅ Loaded .env successfully');
  console.log(`   Path: ${envPath}`);
} else {
  console.warn('⚠️  No .env.local or .env found');
  console.warn(`   Searched: ${envLocalPath}`);
  console.warn(`   Searched: ${envPath}`);
  dotenv.config(); // Try default .env in current directory
}

// Export env vars for reference (optional)
export default {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

