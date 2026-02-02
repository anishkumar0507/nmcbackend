import express from 'express';
import { signup, login, getCurrentUser } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/signup', signup);
router.post('/login', login);

// Protected route - get current user
router.get('/me', authenticateToken, getCurrentUser);

export default router;

