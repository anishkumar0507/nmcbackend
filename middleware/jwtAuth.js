/**
 * JWT Authentication Middleware
 * Replaces Firebase Auth with JWT-based authentication
 */

import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Authenticate JWT token
 */
export const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    console.log(`🔍 JWT Auth - Authorization header present: ${!!authHeader}`);
    console.log(`🔍 JWT Auth - Header value: ${authHeader ? authHeader.substring(0, 20) + '...' : 'NONE'}`);
    
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      console.log('❌ JWT token missing in Authorization header');
      console.log(`   Full header: ${JSON.stringify(req.headers)}`);
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid JWT token in Authorization header'
      });
    }

    console.log(`🔍 JWT Auth - Token received: ${token.substring(0, 20)}... (${token.length} chars)`);
    console.log(`🔍 JWT Auth - JWT_SECRET: ${JWT_SECRET ? JWT_SECRET.substring(0, 10) + '...' : 'MISSING'}`);

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log(`✅ JWT decoded successfully:`, { userId: decoded.userId, email: decoded.email, name: decoded.name });
      
      let user = await User.findById(decoded.userId).select('-password');
      
      // Auto-create user if not found (from JWT payload)
      if (!user && decoded.email) {
        console.log(`⚠️  User not found, auto-creating from JWT payload: ${decoded.email}`);
        try {
          // Create user with email from JWT payload
          user = await User.create({
            email: decoded.email,
            name: decoded.name || decoded.email.split('@')[0],
            password: 'temp-password-' + Date.now(), // Temporary password, user should update
            isAutoCreated: true
          });
          console.log(`✅ Auto-created user: ${user.email} (${user._id})`);
        } catch (createError) {
          // If creation fails (e.g., duplicate email), try to find by email
          if (createError.code === 11000) {
            user = await User.findOne({ email: decoded.email }).select('-password');
            if (user) {
              console.log(`✅ Found existing user by email: ${user.email}`);
            }
          }
          
          if (!user) {
            console.error(`❌ Failed to create/find user:`, createError.message);
            return res.status(401).json({
              error: 'User creation failed',
              message: 'Could not create or find user from token'
            });
          }
        }
      }
      
      if (!user) {
        console.log(`❌ User not found for userId: ${decoded.userId}`);
        return res.status(401).json({
          error: 'Invalid token',
          message: 'User not found and could not be created'
        });
      }
      
      req.user = {
        _id: user._id.toString(),
        userId: user._id.toString(),
        email: user.email,
        name: user.name
      };
      
      console.log(`✅ JWT authenticated: ${user.email} (${user._id})`);
      next();
    } catch (tokenError) {
      console.error('❌ JWT verification failed:', tokenError.message);
      console.error('   Token error name:', tokenError.name);
      console.error('   Token error code:', tokenError.code);
      console.error('   Token (first 50 chars):', token.substring(0, 50));
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token verification failed: ' + tokenError.message,
        details: tokenError.name === 'JsonWebTokenError' ? 'Token format is invalid' : 
                 tokenError.name === 'TokenExpiredError' ? 'Token has expired' :
                 tokenError.name === 'NotBeforeError' ? 'Token not active yet' :
                 'Unknown token error'
      });
    }
  } catch (error) {
    console.error('❌ JWT Auth error:', error);
    return res.status(500).json({
      error: 'Authentication error',
      message: error.message
    });
  }
};

/**
 * Optional JWT authentication (allows unauthenticated access)
 */
export const optionalJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        
        if (user) {
          req.user = {
            _id: user._id.toString(),
            userId: user._id.toString(),
            email: user.email,
            name: user.name
          };
        }
      } catch (tokenError) {
        // Invalid token, but continue without user
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

/**
 * Generate JWT token
 * Includes userId, email, and name for auto-user creation
 */
export function generateToken(user) {
  const payload = {
    userId: user._id || user.id || user.userId,
    email: user.email,
    name: user.name
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

