import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // Allow access without token (direct login enabled)
    if (!token) {
      // Set default user for direct access
      req.user = {
        _id: 'default-user',
        name: 'User',
        email: 'user@satark.ai'
      };
      return next();
    }

    // If token is provided, try to verify it
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (user) {
        req.user = user;
      } else {
        // Token is invalid but allow access with default user
        req.user = {
          _id: 'default-user',
          name: 'User',
          email: 'user@satark.ai'
        };
      }
    } catch (tokenError) {
      // Token is invalid but allow access with default user
      req.user = {
        _id: 'default-user',
        name: 'User',
        email: 'user@satark.ai'
      };
    }

    next();
  } catch (error) {
    // Even on error, allow access with default user
    req.user = {
      _id: 'default-user',
      name: 'User',
      email: 'user@satark.ai'
    };
    next();
  }
};

export const generateToken = (user) => {
  const payload = {
    userId: user._id || user.id || user.userId,
    email: user.email,
    name: user.name
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

