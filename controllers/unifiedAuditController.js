/**
 * UNIFIED AUDIT CONTROLLER
 * Single controller for all source types using centralized audit engine
 */

import { auditText } from '../services/auditService.js';
import { 
  extractFromScreen, 
  extractFromVoice, 
  extractFromVideo,
  extractFromScanner,
  extractFromResearch
} from '../services/sourceExtractionService.js';
import Audit from '../models/Audit.js';
import { saveAudit } from '../services/mongodbService.js';

/**
 * Unified audit endpoint
 * POST /api/audit
 * Body: { sourceType, sourceData, metadata }
 */
export async function auditContent(req, res) {
  try {
    const userId = req.user?.userId;
    const userEmail = req.user?.email;
    
    if (!userId || !userEmail) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'User not authenticated'
      });
    }

    const { sourceType, sourceData, metadata = {} } = req.body;

    // Validate source type
    const validSourceTypes = ['screen', 'voice', 'scanner', 'research', 'manual'];
    if (!validSourceTypes.includes(sourceType)) {
      return res.status(400).json({
        error: 'Invalid source type',
        message: `Source type must be one of: ${validSourceTypes.join(', ')}`
      });
    }

    console.log(`🔍 Starting audit for source type: ${sourceType}`);
    console.log(`   User: ${userEmail}`);

    let extractedText = '';
    let extractionMetadata = {};

    // Extract text based on source type
    switch (sourceType) {
      case 'screen':
        // sourceData: { imageData (Buffer or path) }
        const screenResult = await extractFromScreen(sourceData.imageData);
        extractedText = screenResult.text;
        extractionMetadata = {
          filename: metadata.filename,
          confidence: screenResult.confidence,
          method: screenResult.method
        };
        break;

      case 'voice':
        // sourceData: { audioData (Buffer or path) }
        const voiceResult = await extractFromVoice(sourceData.audioData);
        extractedText = voiceResult.text;
        extractionMetadata = {
          duration: voiceResult.duration,
          method: 'speech-to-text'
        };
        break;

      case 'scanner':
        // sourceData: { fileData (Buffer or path), filename, mimeType }
        const scannerResult = await extractFromScanner(
          sourceData.fileData,
          sourceData.filename,
          sourceData.mimeType
        );
        extractedText = scannerResult.text;
        extractionMetadata = {
          filename: sourceData.filename,
          fileType: scannerResult.fileType,
          method: scannerResult.method
        };
        break;

      case 'research':
        // sourceData: { url }
        const researchResult = await extractFromResearch(sourceData.url);
        extractedText = researchResult.text;
        extractionMetadata = {
          url: sourceData.url,
          title: researchResult.title
        };
        break;

      case 'manual':
        // sourceData: { text }
        extractedText = sourceData.text || '';
        extractionMetadata = {
          submittedBy: userEmail
        };
        break;

      default:
        return res.status(400).json({
          error: 'Invalid source type',
          message: `Unsupported source type: ${sourceType}`
        });
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({
        error: 'No text extracted',
        message: 'Failed to extract text from source. Please check your input.'
      });
    }

    console.log(`✅ Text extracted: ${extractedText.length} characters`);

    // Run audit using centralized engine
    const auditResult = await auditText(extractedText, sourceType, {
      ...extractionMetadata,
      ...metadata
    });

    // Save audit to MongoDB
    const auditDoc = {
      userId,
      sourceType,
      sourceId: metadata.sourceId || extractionMetadata.url || 'manual',
      sourceMetadata: {
        ...extractionMetadata,
        ...metadata
      },
      extractedText,
      auditResult: {
        status: auditResult.status,
        risk_score: auditResult.risk_score,
        violations: auditResult.violations,
        rules_triggered: auditResult.rules_triggered,
        explanation: auditResult.explanation,
        recommended_fix: auditResult.recommended_fix
      },
      status: 'completed'
    };

    const savedAudit = await saveAudit(auditDoc);
    console.log(`✅ Audit saved to MongoDB: ${savedAudit._id}`);

    res.json({
      success: true,
      audit: {
        id: savedAudit._id.toString(),
        sourceType,
        status: auditResult.status,
        risk_score: auditResult.risk_score,
        violations: auditResult.violations,
        rules_triggered: auditResult.rules_triggered,
        explanation: auditResult.explanation,
        recommended_fix: auditResult.recommended_fix,
        extractedTextLength: extractedText.length,
        createdAt: savedAudit.createdAt
      }
    });

  } catch (error) {
    console.error(`❌ Audit error for user ${req.user?.email}:`, error);
    res.status(500).json({
      error: 'Audit failed',
      message: error.message
    });
  }
}

/**
 * Get audit history for user
 * GET /api/audit/history
 */
export async function getAuditHistory(req, res) {
  try {
    const userId = req.user?.userId;
    const { sourceType } = req.query;

    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const { getUserAudits } = await import('../services/mongodbService.js');
    const audits = await getUserAudits(userId, sourceType ? { sourceType } : {});

    res.json({
      success: true,
      audits: audits.map(audit => ({
        id: audit._id.toString(),
        sourceType: audit.sourceType,
        sourceId: audit.sourceId,
        status: audit.auditResult?.status || 'UNKNOWN',
        risk_score: audit.auditResult?.risk_score || 0,
        violations: audit.auditResult?.violations || [],
        explanation: audit.auditResult?.explanation || '',
        extractedTextLength: audit.extractedText?.length || 0,
        createdAt: audit.createdAt
      })),
      count: audits.length
    });

  } catch (error) {
    console.error(`❌ Get audit history error:`, error);
    res.status(500).json({
      error: 'Failed to fetch audit history',
      message: error.message
    });
  }
}




