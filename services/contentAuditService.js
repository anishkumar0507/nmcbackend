import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { getOpenAIClient, transcribeWithWhisper } from './openaiClient.js';
import { auditText, detectContentLanguage } from './auditService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------------------------------------------
   CONSTANTS
------------------------------------------------------------------- */

const IMAGE_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/m4a': '.m4a',
  'audio/x-m4a': '.m4a',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm'
};

/* ------------------------------------------------------------------
   RISK SCORING (DETERMINISTIC – NO AI)
------------------------------------------------------------------- */

function normalizeRiskLevel(level, score) {
  const normalized = String(level || '').toUpperCase();
  if (['LOW', 'MEDIUM', 'HIGH'].includes(normalized)) return normalized;
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function calculateDeterministicRiskScore(violations) {
  if (!Array.isArray(violations) || violations.length === 0) return 100;

  let score = 100;
  for (const v of violations) {
    const sev = (v?.severity || 'medium').toString().toLowerCase();
    if (sev === 'high' || sev === 'critical') score -= 20;
    else if (sev === 'medium') score -= 10;
    else if (sev === 'low') score -= 5;
    else score -= 10;
  }
  return Math.min(100, Math.max(0, score));
}

/* ------------------------------------------------------------------
   AUDIO/VIDEO EVIDENCE SELECTION HELPERS
------------------------------------------------------------------- */

function splitTranscriptIntoSentences(transcript) {
  const text = (transcript || '').toString().trim();
  if (!text) return [];
  // Split on common sentence terminators (supports Hindi danda as well).
  return text
    .split(/(?<=[.!?؟!]|।)\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function selectBestEvidenceSentence(transcript, violation) {
  const MAX_CHARS = 250;
  const sentences = splitTranscriptIntoSentences(transcript);
  if (sentences.length === 0) return '';

  // Build keywords from description + guidance/suggestion.
  const description = (violation?.description || violation?.violation || '').toString();
  const guidance = (violation?.guidance || violation?.suggestion || '').toString();
  const source = `${description} ${guidance}`;

  const tokens = source
    .replace(/[^a-zA-Z0-9\u0900-\u097F\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 4)
    .slice(0, 12);

  let bestSentence = sentences[0];
  let bestScore = -1;

  if (tokens.length > 0) {
    sentences.forEach(sentence => {
      const low = sentence.toLowerCase();
      const score = tokens.reduce(
        (acc, t) => acc + (low.includes(t.toLowerCase()) ? 1 : 0),
        0
      );
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence;
      }
    });
  }

  // If no token-based match, fall back to the shortest sentence (more concise).
  if (bestScore <= 0) {
    bestSentence = sentences.reduce(
      (shortest, current) =>
        current.length < shortest.length ? current : shortest,
      sentences[0]
    );
  }

  // Hard cap length to 250 characters (trim at word boundary when possible).
  if (bestSentence.length > MAX_CHARS) {
    const sliced = bestSentence.slice(0, MAX_CHARS + 1);
    const lastSpace = sliced.lastIndexOf(' ');
    bestSentence = (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced.slice(0, MAX_CHARS)).trim();
  }

  return bestSentence;
}

/* ------------------------------------------------------------------
   HELPERS
------------------------------------------------------------------- */

function extractTextFromHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchUrlText(url) {
  try {
    const res = await axios.get(url, { timeout: 20000 });
    return extractTextFromHtml(String(res.data)).slice(0, 30000);
  } catch {
    return '';
  }
}

function bufferToDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function getMimeFromPath(filePath, fallback = 'application/octet-stream') {
  const ext = path.extname(filePath || '').toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || fallback;
}

async function resolveImageUrl({ content, url, filePath }) {
  if (content?.startsWith('data:')) return content;
  if (url) return url;
  if (filePath) {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(__dirname, '..', filePath);
    const buffer = await fs.readFile(abs);
    return bufferToDataUrl(buffer, getMimeFromPath(abs, 'image/jpeg'));
  }
  return null;
}

/* ------------------------------------------------------------------
   VISION AUDIT
------------------------------------------------------------------- */

async function runVisionAudit({ imageUrl, detectedLang }) {
  const client = getOpenAIClient();
  const system =
    detectedLang === 'hi'
      ? 'All output MUST be in Hindi only.'
      : 'All output MUST be in English only.';

  const prompt = `
You are Satark AI, a compliance auditor for Indian healthcare advertising.

Analyze the IMAGE content and identify compliance violations.

Rules:
- Identify violations with severity (LOW / MEDIUM / HIGH)
- Explain WHY (guidance)
- Provide HOW to fix (recommended_fix)
- Do NOT generate risk score

Return STRICT JSON only.
`;

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ],
    temperature: 0,
    response_format: { type: 'json_object' }
  });

  return JSON.parse(res.choices[0].message.content);
}

/* ------------------------------------------------------------------
   MAIN ENTRY
------------------------------------------------------------------- */

export async function runContentAudit(payload) {
  const { type, content, url, filePath, fileBuffer, filename, mimeType } = payload;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }

  /* ---------- TEXT ---------- */
  if (type === 'text') {
    const audit = await auditText(content || '', 'manual', {});
    const violations = audit.violations || [];
    const riskScore = calculateDeterministicRiskScore(violations);

    return {
      normalized: {
        riskScore,
        riskLevel: normalizeRiskLevel(null, riskScore),
        verdict: audit.summary || 'Audit completed.',
        violations,
        recommendations: audit.recommended_actions || []
      },
      extractedText: content,
      transcription: null
    };
  }

  /* ---------- URL ---------- */
  if (type === 'url') {
    const text = await fetchUrlText(url || content);
    if (!text) throw new Error('Failed to fetch URL content');

    const audit = await auditText(text, 'url', {});
    const violations = audit.violations || [];
    const riskScore = calculateDeterministicRiskScore(violations);

    return {
      normalized: {
        riskScore,
        riskLevel: normalizeRiskLevel(null, riskScore),
        verdict: audit.summary || 'Audit completed.',
        violations,
        recommendations: audit.recommended_actions || []
      },
      extractedText: text,
      transcription: null
    };
  }

  /* ---------- IMAGE ---------- */
  if (type === 'image') {
    const imageUrl = await resolveImageUrl({ content, url, filePath });
    if (!imageUrl) throw new Error('Image input missing');

    const lang = detectContentLanguage(content || '');
    const vision = await runVisionAudit({ imageUrl, detectedLang: lang });
    const violations = vision.issues || [];
    const riskScore = calculateDeterministicRiskScore(violations);

    return {
      normalized: {
        riskScore,
        riskLevel: normalizeRiskLevel(null, riskScore),
        verdict: vision.summary || 'Audit completed.',
        violations,
        recommendations: []
      },
      extractedText: '[Image]',
      transcription: null
    };
  }

  /* ---------- AUDIO / VIDEO ---------- */
  if (type === 'audio' || type === 'video') {
    try {
      let buffer = null;
      let effectiveName = filename || (filePath ? path.basename(filePath) : `${type}-input`);

      if (fileBuffer && fileBuffer.length > 0) {
        // Preferred path: buffer from multipart upload
        buffer = fileBuffer;
      } else if (content && typeof content === 'string' && content.startsWith('data:')) {
        // Fallback: decode data URL sent by older clients
        const match = /^data:(.+);base64,(.+)$/.exec(content);
        if (!match) {
          throw new Error('Invalid media data URL');
        }
        buffer = Buffer.from(match[2], 'base64');
      } else if (filePath) {
        // Legacy fallback when server-side filePath is available
        buffer = await fs.readFile(filePath);
      } else {
        throw new Error(`No ${type} file provided. Please upload an audio/video file.`);
      }

      const transcript = await transcribeWithWhisper(buffer, effectiveName);

      if (!transcript || !transcript.trim()) {
        throw new Error('Transcription returned empty result');
      }

      // Treat all media transcripts as "voice" audits for consistency
      const audit = await auditText(transcript, 'voice', {});
      const originalViolations = Array.isArray(audit.violations) ? audit.violations : [];

      // Post-process EACH violation: map to a single sentence/phrase from the transcript.
      const processedViolations = originalViolations.map(v => {
        const evidenceSentence = selectBestEvidenceSentence(transcript, v);
        return {
          ...v,
          evidence: evidenceSentence,
          problematicContent: evidenceSentence
        };
      });

      const riskScore = calculateDeterministicRiskScore(processedViolations);

      return {
        normalized: {
          riskScore,
          riskLevel: normalizeRiskLevel(null, riskScore),
          verdict: audit.summary || 'Audit completed.',
          violations: processedViolations,
          recommendations: audit.recommended_actions || []
        },
        // Do NOT expose full transcript in UI-visible fields.
        extractedText: type === 'audio' ? '[Audio content]' : '[Video content]',
        transcription: null
      };
    } catch (err) {
      const msg = err?.message || String(err);
      throw new Error(`Failed to process ${type} content: ${msg}`);
    }
  }

  throw new Error(`Unsupported audit type: ${type}`);
}
