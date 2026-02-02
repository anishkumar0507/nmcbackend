import { runContentAudit } from '../services/contentAuditService.js';
import { saveAudit } from '../services/mongodbService.js';

const VALID_TYPES = ['text', 'url', 'image', 'video', 'audio'];
const VALID_MODES = ['standard'];

function mapRiskLevelToStatus(riskLevel) {
  switch (riskLevel) {
    case 'HIGH':
      return 'NON_COMPLIANT';
    case 'MEDIUM':
      return 'NEEDS_REVIEW';
    default:
      return 'COMPLIANT';
  }
}

export async function auditContent(req, res) {
  try {
    const userId = req.user?.userId;
    const userEmail = req.user?.email;

    if (!userId || !userEmail) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    let { type, content, url, filePath, industry, mode } = req.body || {};
    let fileBuffer = null;
    let filename = null;
    let mimeType = null;

    // Optional multipart support: accept a file upload without changing existing JSON flows.
    // For images, convert to data URL. For audio/video, pass raw buffer for Whisper.
    if (req.file && req.file.buffer) {
      const inferredType = (() => {
        const mt = (req.file.mimetype || '').toLowerCase();
        if (mt.startsWith('image/')) return 'image';
        if (mt.startsWith('audio/')) return 'audio';
        if (mt.startsWith('video/')) return 'video';
        return null;
      })();

      if (!type && inferredType) {
        type = inferredType;
      }

      fileBuffer = req.file.buffer;
      filename = req.file.originalname;
      mimeType = req.file.mimetype;

      // For images, keep existing data URL behavior (used by vision audit).
      if (type === 'image') {
        content = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      }

      console.log(`📥 Multipart file received for audit`);
      console.log(`   filename: ${req.file.originalname}`);
      console.log(`   mimetype: ${req.file.mimetype}`);
      console.log(`   size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);
    }

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid type',
        message: `type must be one of: ${VALID_TYPES.join(', ')}`
      });
    }

    if (!industry || typeof industry !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid industry',
        message: 'industry is required'
      });
    }

    // Default to standard mode if not provided, but keep validation if present.
    if (!mode) {
      mode = 'standard';
    } else if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mode',
        message: `mode must be one of: ${VALID_MODES.join(', ')}`
      });
    }

    if (!content && !url && !filePath && !fileBuffer) {
      return res.status(400).json({
        success: false,
        error: 'Missing content',
        message: 'Provide content, url, filePath, or upload a file'
      });
    }

    const { normalized, extractedText, transcription } = await runContentAudit({
      type,
      content,
      url,
      filePath,
      industry,
      mode,
      fileBuffer,
      filename,
      mimeType
    });

    const status = mapRiskLevelToStatus(normalized.riskLevel);

    const auditDoc = {
      userId,
      sourceType: type,
      sourceId: url || filePath || filename || `${type}-${Date.now()}`,
      sourceMetadata: {
        industry,
        mode,
        url,
        filePath,
        filename,
        mimeType,
        userEmail,
        transcription
      },
      extractedText: extractedText || `[${type} audit content unavailable]`,
      auditResult: {
        status,
        risk_score: normalized.riskScore,
        violations: normalized.violations,
        rules_triggered: [],
        explanation: normalized.verdict,
        recommended_fix: normalized.recommendations[0] || 'Review the content for compliance.'
      },
      status: 'completed',
      openaiResponse: normalized
    };

    const savedAudit = await saveAudit(auditDoc);

    return res.json({
      success: true,
      auditId: savedAudit?._id?.toString(),
      // Keep backward compatibility: result still contains the normalized fields,
      // but now also includes transcription for audio/video so UI can display it.
      result: {
        ...normalized,
        transcription: transcription || undefined
      }
    });
  } catch (error) {
    console.error('❌ Content audit error:', error);
    return res.status(500).json({
      success: false,
      error: 'Audit failed',
      message: error.message
    });
  }
}
