import { getAuth } from '../config/firebaseAdmin.js';

/**
 * Express middleware to authenticate Firebase Auth ID tokens
 * 
 * Extracts Bearer token from Authorization header and verifies it using Firebase Admin.
 * Attaches req.user = { uid, email } on success.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export async function authenticateFirebaseToken(req, res, next) {
  try {
    // Extract Authorization header
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Missing Authorization header or invalid format');
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Authorization: Bearer <token>',
        code: 'NO_TOKEN'
      });
    }

    // Extract token from "Bearer <token>"
    const token = authHeader.split(' ')[1];

    if (!token) {
      console.log('❌ Token not found in Authorization header');
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Token not found in Authorization header',
        code: 'NO_TOKEN'
      });
    }

    try {
      // Verify token using Firebase Admin Auth
      const auth = getAuth();
      const decodedToken = await auth.verifyIdToken(token);

      // Log decoded user info
      console.log('✅ Firebase token verified');
      console.log('✅ Decoded UID:', decodedToken.uid);
      console.log('✅ Decoded Email:', decodedToken.email || 'N/A');

      // Attach user info to request object
      req.user = {
        uid: decodedToken.uid,
        email: decodedToken.email || null,
      };

      // Continue to next middleware/route handler
      next();
    } catch (error) {
      // Token verification failed
      console.error('❌ Firebase token verification failed');
      console.error('❌ Error message:', error.message);
      console.error('❌ Error code:', error.code || 'UNKNOWN');
      
      // Provide helpful error messages
      let errorMessage = 'Token verification failed';
      if (error.code === 'auth/id-token-expired') {
        errorMessage = 'Token expired. Please sign in again.';
      } else if (error.code === 'auth/id-token-revoked') {
        errorMessage = 'Token revoked. Please sign in again.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return res.status(401).json({ 
        error: 'Invalid token',
        message: errorMessage,
        code: error.code || 'INVALID_TOKEN'
      });
    }
  } catch (error) {
    // Unexpected error in middleware
    console.error('❌ Authentication middleware error:', error);
    return res.status(500).json({ 
      error: 'Authentication error',
      message: error.message || 'An unexpected error occurred during authentication',
      code: 'AUTH_ERROR'
    });
  }
}
