import User from '../models/User.js';
import { generateToken } from '../middleware/auth.js';

export const signup = async (req, res) => {
  try {
    // Safely read req.body
    const { name, email, password } = req.body || {};

    // Validate missing fields
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists with this email' });
    }

    // Create new user (password will be hashed by pre-save hook)
    const user = new User({ 
      name: name.trim(), 
      email: email.toLowerCase().trim(), 
      password 
    });
    
    // Save user to MongoDB
    await user.save();

    // Generate token (includes user email for auto-creation)
    const token = generateToken(user);

    // Return proper JSON response
    return res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    
    // Handle MongoDB duplicate key error (409 Conflict)
    if (error.code === 11000) {
      return res.status(409).json({ error: 'User already exists with this email' });
    }
    
    // Handle validation errors (400 Bad Request)
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ error: messages.join(', ') });
    }
    
    // Handle database connection errors (500 Internal Server Error)
    if (error.name === 'MongoNetworkError' || error.name === 'MongoServerSelectionError') {
      return res.status(500).json({ error: 'Database connection failed. Please check if MongoDB is running.' });
    }
    
    // Handle unexpected errors (500 Internal Server Error)
    return res.status(500).json({ error: 'Server error during signup', message: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const origin = req.headers?.origin || '(no origin)';
    const ua = req.headers?.['user-agent'] || '(no user-agent)';
    const ip = req.headers?.['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || '(unknown ip)';
    const { email, password } = req.body || {};

    console.log(`🔐 LOGIN request`);
    console.log(`   origin: ${origin}`);
    console.log(`   ip: ${ip}`);
    console.log(`   user-agent: ${ua}`);
    console.log(`   email: ${(email || '').toString().trim().toLowerCase() || '(missing)'}`);

    // Validation
    if (!email || !password) {
      console.log(`❌ LOGIN missing credentials`);
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`❌ LOGIN failed: user not found`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      console.log(`❌ LOGIN failed: invalid password`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token (includes user email for auto-creation)
    const token = generateToken(user);

    console.log(`✅ LOGIN success: ${user.email}`);
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login', message: error.message });
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    // Handle default user from authenticateToken middleware
    if (req.user._id === 'default-user') {
      return res.json({ 
        user: {
          id: 'default-user',
          name: 'User',
          email: 'user@satark.ai'
        }
      });
    }
    
    const user = await User.findById(req.user._id || req.user.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ 
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
};

