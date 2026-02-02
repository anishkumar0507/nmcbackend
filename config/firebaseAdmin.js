import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// SINGLE SOURCE OF TRUTH - Only place where admin.initializeApp() is called
let app;

export function initializeFirebaseAdmin() {
  // If already initialized, return existing app
  if (admin.apps.length > 0) {
    app = admin.apps[0];
    console.log('✅ Firebase Admin already initialized');
    return;
  }

  // Priority 1: Check for service account JSON file (REQUIRED - do not skip)
  const serviceAccountPath = join(__dirname, '../firebase-service-account.json');
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      
      // Validate required fields
      if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
        throw new Error('Service account file missing required fields (project_id, private_key, client_email)');
      }
      
      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id // Explicitly set project ID
      });
      
      console.log('✅ Firebase Admin initialized with service account file');
      console.log('✅ Project ID:', serviceAccount.project_id);
      console.log('✅ Client Email:', serviceAccount.client_email);
      return;
    } catch (error) {
      console.error('❌ Failed to load service account file:', error.message);
      throw new Error(`Firebase Admin initialization failed: ${error.message}`);
    }
  } else {
    console.error('❌ Service account file not found at:', serviceAccountPath);
    throw new Error('Firebase service account file not found. Please ensure server/firebase-service-account.json exists.');
  }

  // Priority 2: Check for service account credentials from environment variables
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    console.log('✅ Firebase Admin initialized with project:', process.env.FIREBASE_PROJECT_ID);
    return;
  }

  // Priority 3: Try service account JSON from environment variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('✅ Firebase Admin initialized with service account JSON from env');
      return;
    } catch (error) {
      console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', error.message);
    }
  }

  // Priority 4: Try application default credentials (for GCP/Firebase CLI)
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'nmc-ai-4a8c1';
    app = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: projectId // Explicitly set project ID
    });
    console.log('✅ Firebase Admin initialized with application default credentials');
    console.log('✅ Project ID:', projectId);
    return;
  } catch (error) {
    // Last resort: Initialize with project ID only (for token verification)
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'nmc-ai-4a8c1';
    console.warn('⚠️  Firebase Admin: No credentials found. Using project ID only.');
    console.warn('⚠️  For production, set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
    app = admin.initializeApp({
      projectId: projectId
    });
    console.log(`✅ Firebase Admin initialized with project ID: ${projectId} (token verification only)`);
  }
}

export function getAuth() {
  if (admin.apps.length === 0) {
    throw new Error('Firebase Admin not initialized. Call initializeFirebaseAdmin() first.');
  }
  if (!app) {
    app = admin.apps[0];
  }
  // Use the app instance explicitly
  return admin.auth(app);
}

// Export admin instance for direct use
export function getAdmin() {
  if (admin.apps.length === 0) {
    throw new Error('Firebase Admin not initialized. Call initializeFirebaseAdmin() first.');
  }
  if (!app) {
    app = admin.apps[0];
  }
  return admin;
}

export function getFirestore() {
  if (!app && admin.apps.length === 0) {
    throw new Error('Firebase Admin not initialized. Call initializeFirebaseAdmin() first.');
  }
  if (!app) {
    app = admin.apps[0];
  }
  return admin.firestore(app);
}

export default admin;

