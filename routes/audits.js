/**
 * UNIFIED AUDITS API ROUTES
 * 
 * Centralized audit endpoints for all source types:
 * - Screen Audit
 * - Live Voice
 * - Scanner
 * - Research Agent
 * - Manual Auditor
 */

import express from 'express';
import multer from 'multer';
import { authenticateJWT } from '../middleware/jwtAuth.js';
import * as unifiedAuditController from '../controllers/unifiedAuditController.js';
import * as contentAuditController from '../controllers/contentAuditController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Conditionally apply multer only for multipart requests (keeps JSON flow unchanged)
function maybeMulterSingle(fieldName) {
  const mw = upload.single(fieldName);
  return (req, res, next) => {
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('multipart/form-data')) {
      return mw(req, res, next);
    }
    return next();
  };
}

/**
 * POST /api/audit
 * Unified audit endpoint for all source types
 * 
 * Body:
 * {
 *   sourceType: 'screen' | 'voice' | 'scanner' | 'research' | 'manual',
 *   sourceData: {
 *     // For screen: { imageData: Buffer or path }
 *     // For voice: { audioData: Buffer or path }
 *     // For scanner: { fileData: Buffer or path, filename, mimeType }
 *     // For research: { url: string }
 *     // For manual: { text: string }
 *   },
 *   metadata: { sourceId?, filename?, etc. }
 * }
 */
router.post('/', authenticateJWT, unifiedAuditController.auditContent);
router.post('/content', authenticateJWT, maybeMulterSingle('file'), contentAuditController.auditContent);

/**
 * GET /api/audit/history
 * Get audit history for authenticated user
 * 
 * Query params:
 *   - sourceType: Filter by source type (optional)
 */
router.get('/history', authenticateJWT, unifiedAuditController.getAuditHistory);

export default router;

