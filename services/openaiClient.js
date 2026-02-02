import OpenAI from 'openai';
import fs from 'fs';
import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { randomUUID, createHash } from 'crypto';

// Initialize OpenAI client (singleton pattern)
let openaiClient = null;

function detectContentLanguage(text) {
  const s = (text || '').toString();
  // Lightweight script-based detection (primarily Hindi vs English).
  const devanagari = (s.match(/[\u0900-\u097F]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;

  if (devanagari >= 20 && devanagari >= latin) return 'hi';
  return 'en';
}

function languageName(lang) {
  switch (lang) {
    case 'hi':
      return 'Hindi';
    default:
      return 'English';
  }
}

function stripEnglishTranslationLine(text) {
  return (text || '')
    .toString()
    .split('\n')
    .filter((line) => !/^\(English translation:\s*/.test(line.trim()))
    .join('\n')
    .trim();
}

function hasEnglishTranslationLine(text) {
  return /\(English translation:\s*[^)]+\)/.test((text || '').toString());
}

// Ensure English translation is added after content if not present (fail-safe)
async function ensureEnglishTranslation(text, detectedLang, client, systemPrompt, fieldName = 'content') {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  
  // If already has translation, return as-is
  if (hasEnglishTranslationLine(text)) {
    return text;
  }
  
  // If language is English, no translation needed
  if (detectedLang === 'en') {
    return text;
  }
  
  // For non-English, if translation is missing, generate it (fail-safe)
  console.warn(`⚠️  Missing English translation for ${fieldName}. Generating translation...`);
  
  try {
    const translationPrompt = `Translate the following ${fieldName} from ${detectedLang === 'hi' ? 'Hindi' : 'the detected language'} to English. Return ONLY the English translation, nothing else.

${text}`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt || 'You are a translation assistant.' },
        { role: 'user', content: translationPrompt }
      ],
      temperature: 0,
      top_p: 1,
      max_tokens: 500
    });

    const translation = completion.choices[0]?.message?.content?.trim() || '';
    
    if (translation && translation.trim().length > 0) {
      const result = `${text}\n(English translation: ${translation})`;
      console.log(`✅ Generated English translation for ${fieldName}`);
      return result;
    }
  } catch (translationError) {
    console.error(`❌ Failed to generate translation for ${fieldName}:`, translationError.message);
  }
  
  // If translation fails, return original text (better than empty)
  return text;
}

function buildLanguageSystemPrompt({ lang, langName }) {
  return `SYSTEM POLICY (STRICT):

LANGUAGE CONTROL (NON-NEGOTIABLE):
- All output MUST be written in ${langName}.
- This applies to: risk_level labels, status labels, summary, issues, evidence, guidance, recommended_fix, and explanations.
- Do NOT mix languages randomly.
- Do NOT translate the entire output to English.

EXCEPTION (MANDATORY, EXACT FORMAT):
- After each Guidance and each Recommended Fix, add ONE line in brackets with an English translation only:
  (English translation: ...)
- That English translation line must be the ONLY English in those fields.

ROLE SEPARATION (NON-NEGOTIABLE):
- Evidence = WHAT exact claim/phrase/behavior triggered the issue.
- Guidance = WHY the regulator considers it harmful/misleading (rule-pack intent + harm). Guidance MUST NOT recommend actions.
- Recommended Fix = HOW to comply (pure actions). Recommended Fix MUST NOT explain intent/harm.`;
}

export function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

/**
 * Run OpenAI Chat Completion API using gpt-4o-mini model
 * 
 * Uses model: gpt-4o-mini (cost-effective for text audit)
 * 
 * @param {string} prompt - Text prompt to send to OpenAI
 * @returns {Promise<string>} Generated text response
 */
export async function runOpenAI(prompt) {
  // Validate API key
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OPENAI_API_KEY environment variable is not set');
    error.code = 'MISSING_API_KEY';
    throw error;
  }

  // Validate prompt
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    const error = new Error('Prompt must be a non-empty string');
    error.code = 'INVALID_PROMPT';
    throw error;
  }

  try {
    console.log(`📤 Calling OpenAI API`);
    console.log(`   SDK: openai`);
    console.log(`   Model: gpt-4o-mini`);
    console.log(`   Text Length: ${prompt.length} characters`);
    
    // Get OpenAI client
    const client = getOpenAIClient();

    // Generate content using chat completion
    const options = arguments.length >= 2 && typeof arguments[1] === 'object' ? arguments[1] : {};
    const system = options?.system;

    const messages = [];
    if (system && typeof system === 'string' && system.trim().length > 0) {
      messages.push({ role: 'system', content: system.trim() });
    }
    messages.push({ role: 'user', content: prompt });

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0, // Deterministic: same input = same output
      top_p: 1, // Deterministic: use all tokens
      max_tokens: 2000
    });

    const text = completion.choices[0]?.message?.content;

    if (!text || text.trim().length === 0) {
      const error = new Error('Empty response from OpenAI API');
      error.code = 'EMPTY_RESPONSE';
      throw error;
    }

    console.log(`✅ OpenAI API success (${text.length} characters)`);
    return text.trim();
  } catch (error) {
    // Determine error code
    if (!error.code) {
      if (error.message && (error.message.includes('API key') || error.message.includes('authentication'))) {
        error.code = 'AUTHENTICATION_ERROR';
      } else if (error.message && (error.message.includes('model') || 
                 error.message.includes('not found'))) {
        error.code = 'MODEL_ERROR';
      } else if (error.message && (error.message.includes('quota') || error.message.includes('rate limit'))) {
        error.code = 'RATE_LIMIT_ERROR';
      } else {
        error.code = 'OPENAI_API_ERROR';
      }
    }

    // Enhanced error logging
    console.error(`❌ OpenAI API error:`);
    console.error(`   Error Code: ${error.code || 'UNKNOWN'}`);
    console.error(`   Error Message: ${error.message || 'Unknown error'}`);
    console.error(`   Error Type: ${error.constructor.name}`);
    
    // Log API response details if available
    if (error.response) {
      console.error(`   API Status: ${error.response.status}`);
      console.error(`   API Data:`, JSON.stringify(error.response.data || {}).substring(0, 500));
    }
    
    // Log stack trace in development
    if (process.env.NODE_ENV === 'development' && error.stack) {
      console.error(`   Stack Trace (first 500 chars):`, error.stack.substring(0, 500));
    }

    throw error;
  }
}

function hasFfmpeg() {
  try {
    const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function runFfmpegExtractAudio({ inputPath, outputPath }) {
  await fse.ensureDir(path.dirname(outputPath));

  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', inputPath,
      '-vn',
      '-acodec', 'mp3',
      outputPath
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) return resolve(outputPath);
      return reject(new Error(`ffmpeg failed (code ${code}). ${stderr || ''}`.trim()));
    });
  });
}

/**
 * Run OpenAI audit for email content
 * 
 * @param {string} emailContent - Email body text
 * @param {Array} attachments - Array of attachment objects with {filename, type, text}
 * @param {Object} metadata - Metadata object with {emailId, subject, sender, etc.}
 * @returns {Promise<Object>} Structured audit result
 */
export async function runOpenAIAudit(emailContent, attachments = [], metadata = {}) {
  // Validate API key
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OPENAI_API_KEY environment variable is not set');
    error.code = 'MISSING_API_KEY';
    throw error;
  }

  try {
    // Build comprehensive audit input
    let auditInput = `EMAIL TO AUDIT:\n`;
    auditInput += `Subject: ${metadata.subject || '(No Subject)'}\n`;
    auditInput += `From: ${metadata.sender || metadata.from || 'Unknown Sender'}\n`;
    auditInput += `To: ${metadata.to || 'Unknown Recipient'}\n`;
    auditInput += `Date: ${metadata.receivedAt ? new Date(metadata.receivedAt).toISOString() : 'Unknown'}\n\n`;
    
    auditInput += `EMAIL BODY:\n${emailContent || '(No body content)'}\n\n`;

    // Add attachment content
    if (attachments && attachments.length > 0) {
      auditInput += `ATTACHMENTS (${attachments.length}):\n`;
      attachments.forEach((att, idx) => {
        if (att && att.text) {
          // MANDATORY LABELING:
          // Each attachment must be appended clearly as:
          // "Attachment: <filename>"
          const name = att.filename || `attachment-${idx + 1}`;
          const type = att.type || att.mimeType || 'unknown';
          auditInput += `\nAttachment: ${name}\nType: ${type}\n${att.text}\n`;
        }
      });
      auditInput += '\n';
    }

    // Extract URLs from content
    const urlMatches = emailContent.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi) || [];
    if (urlMatches.length > 0) {
      auditInput += `URLs FOUND IN EMAIL:\n${urlMatches.join('\n')}\n\n`;
    }

    // Logging for attachment audit verification
    const hasBodyContent = !!(emailContent && emailContent.trim().length > 0);
    const hasAttachmentContent = attachments && attachments.length > 0 && attachments.some(a => a?.text?.trim());
    if (!hasBodyContent && hasAttachmentContent) {
      console.log(`📎 Email body empty, attachments detected: ${attachments.length} attachment(s)`);
    }
    if (hasAttachmentContent) {
      attachments.forEach((att, idx) => {
        if (att?.text) {
          console.log(`📎 Processing attachment: ${att.filename || `attachment-${idx + 1}`} (${att.type || att.mimeType || 'unknown'})`);
        }
      });
    }

    // Normalize audit input for deterministic hashing
    // CRITICAL: This normalization ensures same logical input = same hash
    function normalizeForHash(text) {
      if (!text || typeof text !== 'string') return '';
      
      return text
        .toString()
        // Normalize whitespace: collapse multiple spaces/tabs/newlines to single space
        .replace(/[\s\t\n\r]+/g, ' ')
        // Normalize casing: convert to lowercase for case-insensitive matching
        .toLowerCase()
        // Normalize punctuation: standardize common punctuation variations
        .replace(/["""'']/g, '"')  // Normalize quotes
        .replace(/[–—]/g, '-')    // Normalize dashes
        .replace(/…/g, '...')     // Normalize ellipsis
        // Trim leading/trailing whitespace
        .trim();
    }

    // Generate deterministic hash from normalized input + audit type + rule-pack version
    // CRITICAL: Hash must include audit_type to ensure different audit types get different results
    const rulePackVersion = 'v1.0.0'; // Version marker for rule-pack changes
    const auditType = 'email'; // Audit type (email audit engine)
    const normalizedInput = normalizeForHash(auditInput);
    const hashInput = `${normalizedInput}|${auditType}|${rulePackVersion}`;
    const inputHash = createHash('sha256')
      .update(hashInput)
      .digest('hex');

    console.log(`🔑 Generated input hash: ${inputHash.substring(0, 16)}...`);

    // DETERMINISTIC RISK SCORE CALCULATION FUNCTION
    // Calculate risk_score based ONLY on violations and severity (no AI involvement)
    // Formula: Start at 100, subtract points based on violation severity
    // - HIGH severity: -20 points each
    // - MEDIUM severity: -10 points each
    // - LOW severity: -5 points each
    // Final score must always be between 0 and 100
    // Same violations must always produce same score (deterministic)
    function calculateDeterministicRiskScore(violations) {
      if (!Array.isArray(violations) || violations.length === 0) {
        return 100; // No violations = perfect score (100)
      }

      let score = 100; // Start at 100 (perfect score)
      
      for (const violation of violations) {
        const severity = (violation?.severity || 'Medium').toString().toLowerCase();
        
        if (severity === 'critical' || severity === 'high') {
          score -= 20;
        } else if (severity === 'medium') {
          score -= 10;
        } else if (severity === 'low') {
          score -= 5;
        } else {
          // Default to medium if unknown
          score -= 10;
        }
      }
      
      // Clamp between 0 and 100 (ensures valid range)
      return Math.min(100, Math.max(0, score));
    }

    // Check cache for existing audit result (deterministic lookup)
    try {
      const Audit = (await import('../models/Audit.js')).default;
      const cachedAudit = await Audit.findOne({ inputHash, status: 'completed' });
      if (cachedAudit && cachedAudit.auditResult) {
        console.log(`✅ Using cached audit result (hash: ${inputHash.substring(0, 16)}...)`);
        const cachedViolations = Array.isArray(cachedAudit.auditResult.violations) ? cachedAudit.auditResult.violations : [];
        // Recalculate risk_score deterministically from violations (ensures consistency even for old cached results)
        const deterministicRiskScore = calculateDeterministicRiskScore(cachedViolations);
        const deterministicRiskLevel = deterministicRiskScore >= 70 ? 'High' : deterministicRiskScore >= 40 ? 'Medium' : 'Low';
        console.log(`   Risk Level: ${deterministicRiskLevel}`);
        console.log(`   Risk Score: ${deterministicRiskScore} (recalculated deterministically)`);
        // Return cached result in the expected format with deterministic score
        return {
          risk_level: deterministicRiskLevel,
          risk_score: deterministicRiskScore, // Use deterministic calculation instead of cached AI-generated value
          compliance_flags: Array.isArray(cachedAudit.auditResult.compliance_flags) ? cachedAudit.auditResult.compliance_flags : [],
          summary: cachedAudit.auditResult.summary || cachedAudit.auditResult.explanation || 'Audit completed',
          recommended_actions: Array.isArray(cachedAudit.auditResult.recommended_actions) ? cachedAudit.auditResult.recommended_actions : [],
          detected_content_types: Array.isArray(cachedAudit.auditResult.detected_content_types) ? cachedAudit.auditResult.detected_content_types : ['text'],
          violations: cachedViolations,
          status: deterministicRiskScore >= 70 ? 'NON_COMPLIANT' : 'COMPLIANT',
          explanation: cachedAudit.auditResult.explanation || cachedAudit.auditResult.summary || 'Audit completed',
          recommended_fix: cachedAudit.auditResult.recommended_fix || cachedAudit.auditResult.recommended_actions?.[0] || 'Review content for compliance.'
        };
      }
    } catch (cacheError) {
      console.warn(`⚠️  Cache lookup failed (continuing with new audit): ${cacheError.message}`);
    }

    const styleConstraints = `STRICT NON-NEGOTIABLE OUTPUT RULES (HARD ROLE SEPARATION):
- Evidence = WHAT exact claim/phrase/behavior triggered the issue (quote or pinpointed behavior). Evidence must be concrete.
- Guidance = WHY this violates the mapped rule_pack (regulatory intent + consumer/patient harm). Guidance must NOT suggest any action.
- Recommended Fix = Replacement text (WHAT IT SHOULD SAY INSTEAD). It must rewrite the problematic Evidence into compliant copy-ready sentences.

GUIDANCE CONSTRAINTS (STRICT - MANDATORY):
- Guidance MUST explain WHY the issue is risky or non-compliant (principle, regulation intent, user harm).
- Guidance MUST NOT contain ANY action verbs: remove, add, include, ensure, obtain, collect, stop, rewrite, change, update, consult, review, provide, submit, implement, modify, apply, create, delete, replace, insert, document, restrict, verify, check, validate, approve, request, send, receive, process, handle, manage, maintain, store, secure, protect, access, share, disclose, notify, inform, communicate, publish, distribute, display, show, present, indicate, specify, state, declare, claim, assert, guarantee, promise, offer, deliver, perform, execute, complete, finish, start, begin, initiate, launch, establish, set, configure, adjust, adapt, customize, personalize, optimize, improve, enhance, upgrade, fix, repair, correct, resolve, address, solve, prevent, avoid, eliminate, reduce, minimize, maximize, increase, decrease, expand, extend, limit, restrict, allow, permit, enable, disable, activate, deactivate, turn, switch, toggle, open, close, lock, unlock, save, load, export, import, upload, download, copy, paste, cut, move, transfer, assign, allocate, distribute, spread, divide, split, merge, combine, join, connect, link, attach, detach, separate, isolate, integrate, synchronize, coordinate, align, match, compare, contrast, analyze, evaluate, assess, measure, calculate, compute, determine, identify, recognize, detect, discover, find, locate, search, filter, sort, organize, arrange, structure, format, style, design, develop, build, construct, generate, produce, manufacture, make, do, perform, run, or any variant of these verbs.
- Guidance MUST NOT quote or paraphrase the Evidence. Do not reuse evidence wording.
- Guidance MUST anchor to the rule_pack’s intent and explain how it can mislead/ harm consumers/patients/public.
- Tone: senior compliance officer explanation (professional, authoritative, no hedging).

RECOMMENDED FIX CONSTRAINTS (STRICT - MANDATORY):
- Recommended Fix MUST be derived directly from the Evidence by rewriting the problematic line into compliant replacement text.
- Output MUST be in this exact format (no bullets, no numbering):
  RECOMMENDED FIX
  Option A:
  "<ready-to-copy replacement sentence>"
  
  Option B:
  "<alternative ready-to-copy replacement sentence>"
- Each option MUST be a SINGLE compliant replacement line for the exact evidence text.
- Do NOT explain why the line is wrong.
- Do NOT give steps, guidance, or regulatory reasoning.
- Each option must directly replace the original problematic sentence.
- No bullet points, no paragraphs, no generic advice.
- Each option MUST be in the detected input language (English or Hindi). Do NOT switch languages. Do NOT translate.
- Do NOT include any instructional verbs or actions (remove/delete/ensure/add/include/revise/limit/etc.).
- Do NOT include any explanations, regulatory reasoning, risks, benefits, or justification language.
- Do NOT include words/phrases like: because, so that, in order to, to avoid, to prevent, to reduce, regulators, regulatory, intent, harm, risk, misleading, penalty, enforcement, compliance.
- Do NOT reference the “rules” or “guidelines” in the replacement text. The replacement must read like final marketing copy.

UNIQUENESS (MANDATORY):
- Each issue must have unique Guidance and unique Recommended Fix.
- Do not reuse sentence templates across issues. Vary structure and wording. Treat each issue as independent.`;

    // LANGUAGE CONTROL (system-level enforcement)
    const detectedLang = detectContentLanguage(auditInput);
    const systemPrompt = buildLanguageSystemPrompt({
      lang: detectedLang,
      langName: languageName(detectedLang)
    });

    // Build compliance audit prompt
    const prompt = `You are Satark AI, an expert compliance auditor for Indian Healthcare & Data Protection regulations.

AUDIT THE FOLLOWING EMAIL FOR COMPLIANCE VIOLATIONS:

${auditInput}

${styleConstraints}

COMPLIANCE FRAMEWORK:
1. Healthcare Compliance:
   - Drugs and Magic Remedies (Objectionable Advertisements) Act, 1954
   - Drugs and Cosmetics Act, 1940 & Rules (Rule 106 & Schedule J)
   - ASCI Healthcare Guidelines
   - National Medical Commission Regulations

2. Data Protection (DPDP Act 2023):
   - Personal data processing consent
   - Data minimization principles
   - Purpose limitation
   - Data security requirements

AUDIT REQUIREMENTS:
- Detect misleading claims, false promises, or unsubstantiated health claims
- Identify Schedule J disease claims (prohibited)
- Check for missing disclaimers or required disclosures
- Identify data protection violations
- Assign severity level (HIGH / MEDIUM / LOW) for each violation
- Detect content types: text, links, video transcripts, audio transcripts
- IMPORTANT: Every issue MUST include strong Evidence, Guidance (WHY), and Recommended Fix (HOW) suitable for legal/compliance review.

SCORING CONSTRAINTS (MANDATORY):
- DO NOT generate risk_score or penalty - these are calculated automatically by the system from violations.
- Your role is ONLY to identify violations and assign severity (HIGH / MEDIUM / LOW).

EVIDENCE RULES (MANDATORY):
- Evidence MUST NEVER be "N/A", "NA", "None", or empty.
- If a direct quote exists in EMAIL BODY or ATTACHMENTS, include it verbatim in double quotes.
- If inferred from audio/video, describe the exact spoken claim or behavior from the transcript (reference attachment filename).
- Evidence must reference EMAIL BODY or a specific attachment section.

RECOMMENDED FIX RULES (MANDATORY):
- MUST follow the Recommended Fix constraints above (pure actions, no "why", no regulator intent).

RESPONSE FORMAT (STRICT JSON ONLY):
{
  "risk_level": "Low" | "Medium" | "High" | "Critical",
  "compliance_flags": ["flag1", "flag2"],
  "summary": "Brief summary of findings",
  "recommended_actions": ["action1", "action2"],
  "detected_content_types": ["text", "links", "video", "audio"],
  "issues": [
    {
      "severity": "low" | "medium" | "high" | "critical",
      "rule_pack": "ASCI Healthcare" | "Drugs & Cosmetics Act" | "Drugs & Magic Remedies Act" | "NMC Regulations" | "DPDP Act 2023" | "IT Act 2000" | "General",
      "violation": "What violation was found (1-2 sentences)",
      "law_reference": "Specific regulation name (must be explicit)",
      "evidence": "Exact quoted text/phrase OR specific described behavior tied to email/attachment",
      "guidance": "WHY this is a compliance issue according to the rule_pack (intent + harm). MUST NOT suggest actions, use action verbs, or repeat evidence. Focus on regulatory principle and potential harm.",
      "recommended_fix": "Rewrite the Evidence into compliant replacement text. Return ONLY two alternatives in this exact format:\nRECOMMENDED FIX\nOption A:\n\"<single compliant replacement line>\"\n\nOption B:\n\"<alternative compliant replacement line>\"\nNo bullets. No numbering. No instructions. No explanations. Each option must be a single line that directly replaces the original problematic sentence. Must be in the detected input language."
    }
  ],
  "status": "COMPLIANT" | "NON_COMPLIANT",
  "explanation": "Detailed explanation of audit findings"
}

${detectedLang !== 'en' ? `TRANSLATION REQUIREMENT (MANDATORY FOR NON-ENGLISH INPUT):
- If the input language is NOT English, you MUST generate bilingual content for ALL of the following fields:
  • "violation" field
  • "evidence" field
  • "guidance" field
  • "recommended_fix" field
- Each of these fields must follow this EXACT format:
  [Content in the detected input language]
  (English translation: [Complete English translation of the content])
- The English translation must be accurate and complete, not partial or paraphrased.
- ALL four fields (violation, evidence, guidance, recommended_fix) MUST include English translations.
- If any translation is missing, the response is incomplete.` : ''}

Return ONLY valid JSON, no markdown, no code blocks.`;

    console.log(`📤 Calling OpenAI audit API`);
    console.log(`   Model: gpt-4o-mini`);
    console.log(`   Email ID: ${metadata.emailId || 'unknown'}`);
    console.log(`   Attachments: ${attachments.length}`);
    console.log(`   Content Length: ${auditInput.length} characters`);

    const isBadEvidence = (val) => {
      if (!val || typeof val !== 'string') return true;
      const s = val.trim();
      if (s.length === 0) return true;
      return /^(n\/a|na|none|null|not available|unknown)$/i.test(s);
    };

    const isWeakRecommendation = (val) => {
      if (!val || typeof val !== 'string') return true;
      const s = val.trim();
      if (s.length < 15) return true;
      // Reject overly generic recs
      return /(review (the )?policy|be careful|follow guidelines|ensure compliance|consult (a )?lawyer|seek legal advice|please review)/i.test(s);
    };

    const isWeakGuidance = (val) => {
      if (!val || typeof val !== 'string') return true;
      const s = val.trim();
      if (s.length < 25) return true;
      // Reject unhelpful / generic guidance
      return /(be careful|follow guidelines|ensure compliance|consult (a )?lawyer|seek legal advice|please review|non-?compliant)/i.test(s);
    };

    const deriveRulePack = (lawRef) => {
      const s = (lawRef || '').toString().toLowerCase();
      if (s.includes('dpdp') || s.includes('data protection') || s.includes('personal data')) return 'DPDP Act 2023';
      if (s.includes('it act') || s.includes('information technology act')) return 'IT Act 2000';
      if (s.includes('asci')) return 'ASCI Healthcare';
      if (s.includes('magic remedies')) return 'Drugs & Magic Remedies Act';
      if (s.includes('schedule j') || s.includes('drugs and cosmetics') || s.includes('rule 106')) return 'Drugs & Cosmetics Act';
      if (s.includes('national medical commission') || s.includes('nmc')) return 'NMC Regulations';
      return 'General';
    };

    const deriveGuidanceFallback = ({ rulePack }) => {
      switch (rulePack) {
        case 'DPDP Act 2023':
          return `DPDP requires a lawful basis (typically valid consent) for processing personal data, and mandates purpose limitation and data minimization. Handling sensitive patient or contact information without a clear purpose, notice, and consent increases risk of privacy harm, identity misuse, and regulatory penalties.`;
        case 'IT Act 2000':
          return `The IT Act and associated security expectations require reasonable security practices for handling electronic records and personal information. Weak handling of identity/contact details, medical information, or credentials increases risk of unauthorized access, fraud, and consumer harm.`;
        case 'ASCI Healthcare':
          return `ASCI’s healthcare advertising standards require communications to be truthful, capable of substantiation, and not misleading by exaggeration or omission. Unsubstantiated or absolute claims can cause consumers/patients to make unsafe decisions, delay proper medical care, and undermine public trust.`;
        case 'Drugs & Magic Remedies Act':
          return `The Drugs and Magic Remedies Act prohibits advertisements that claim magical cures or guaranteed results for certain conditions. Such claims can mislead vulnerable patients, encourage self-medication, and create serious public health risk, attracting strict enforcement.`;
        case 'Drugs & Cosmetics Act':
          return `Drugs & Cosmetics Rules (including Schedule J / Rule 106 expectations) restrict disease‑cure advertising and require claims to be supported and non-misleading. Disease treatment promises without permitted basis can mislead patients and violate statutory restrictions on therapeutic claims.`;
        case 'NMC Regulations':
          return `NMC-aligned ethical standards require responsible medical communication: no inducement, no misleading therapeutic assurance, and clear separation of medical advice from marketing. Over-promising outcomes can influence patient decisions unfairly and breaches professional/ethical expectations.`;
        default:
          return `Regulators expect healthcare communications to be accurate, substantiated, and non-misleading, especially where patient outcomes or data privacy are involved. Misleading claims or weak data practices can cause real consumer harm and trigger enforcement action.`;
      }
    };

    const deriveRecommendationFallback = (issue) => {
      const rulePack = (issue?.rule_pack || '').toString().trim() || deriveRulePack(issue?.law_reference || issue?.regulation);
      const law = (issue?.law_reference || issue?.regulation || '').toString().toLowerCase();
      const rawEvidence = (issue?.evidence || '').toString();
      const evidenceBody = detectedLang !== 'en' ? stripEnglishTranslationLine(rawEvidence) : rawEvidence;
      const ev = evidenceBody.replace(/^["'\s]+|["'\s]+$/g, '').trim();

      // Heuristic rewrite (fallback only): soften absolutes, avoid guarantees, avoid cures, avoid personal data details.
      const base = ev.length > 0 ? ev : (issue?.violation || '').toString();
      const softened = base
        .replace(/\b(100%|100 percent|guaranteed?|sure shot|instant|permanent)\b/gi, 'may')
        .replace(/\b(cure|cures|cured|treats|treatment for)\b/gi, 'supports')
        .replace(/\b(no side effects)\b/gi, 'as advised by a qualified professional')
        .replace(/\s+/g, ' ')
        .trim();

      const opt1En = softened.length > 0
        ? softened
        : 'Results may vary. Please consult a qualified healthcare professional.';
      const opt2En = 'Results may vary by individual. This information is not a substitute for professional medical advice.';

      // For Hindi, provide a minimal Hindi fallback with English translation line (keeps existing bilingual contract).
      if (detectedLang === 'hi') {
        const optAHi = 'परिणाम व्यक्ति के अनुसार अलग हो सकते हैं।';
        const optBHi = 'यह जानकारी सामान्य है और चिकित्सकीय सलाह का विकल्प नहीं है।';
        return `RECOMMENDED FIX\nOption A:\n"${optAHi}"\n\nOption B:\n"${optBHi}"\n(English translation: Option A: Results may vary by individual. Option B: This information is general and not a substitute for medical advice.)`;
      }

      // Default (English): always two copy-ready options.
      return `RECOMMENDED FIX\nOption A:\n"${opt1En}"\n\nOption B:\n"${opt2En}"`;
    };

    const toTitleSeverity = (sev) => {
      const s = (sev || '').toString().toLowerCase().trim();
      if (s === 'critical') return 'Critical';
      if (s === 'high') return 'High';
      if (s === 'medium') return 'Medium';
      if (s === 'low') return 'Low';
      return 'Medium';
    };

    const deriveEvidenceFallback = (issue) => {
      // Prefer quoting from the audit input if we can find any keyword.
      const text = auditInput || '';
      const violation = (issue?.violation || '').toString();
      const tokens = violation
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length >= 5)
        .slice(0, 8);

      for (const token of tokens) {
        const idx = text.toLowerCase().indexOf(token.toLowerCase());
        if (idx >= 0) {
          const start = Math.max(0, idx - 80);
          const end = Math.min(text.length, idx + 120);
          const snippet = text.substring(start, end).replace(/\s+/g, ' ').trim();
          return `"${snippet}"`;
        }
      }

      // Last resort: include specific risky content summary rather than N/A.
      return `Specific risky content detected in email/attachments related to: "${violation.substring(0, 140)}" (exact quote not available)`;
    };

    const callAuditOnce = async (promptText) => {
      const client = getOpenAIClient();
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: promptText }
        ],
        temperature: 0, // Deterministic: same input = same output
        top_p: 1, // Deterministic: use all tokens
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      });

      const responseText = completion.choices[0]?.message?.content;
      if (!responseText || responseText.trim().length === 0) {
        throw new Error('Empty response from OpenAI API');
      }
      return responseText.trim();
    };

    // First call
    let responseText = await callAuditOnce(prompt);

    // Parse JSON response
    let jsonText = responseText.trim();
    
    // Clean JSON response (remove markdown code blocks if present)
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    let auditResult;
    try {
      auditResult = JSON.parse(jsonText);
      console.log(`✅ OpenAI audit completed successfully`);
      console.log(`   Risk Level: ${auditResult.risk_level || 'Unknown'}`);
      console.log(`   Risk Score: ${auditResult.risk_score || 'N/A'}`);
      console.log(`   Status: ${auditResult.status || 'Unknown'}`);
    } catch (parseError) {
      console.error(`❌ Failed to parse OpenAI response:`, parseError.message);
      console.error(`   Response (first 500 chars):`, jsonText.substring(0, 500));
      throw new Error(`Failed to parse OpenAI audit response: ${parseError.message}`);
    }

    function normalizeTextForCompare(s) {
      return (s || '')
        .toString()
        .toLowerCase()
        .replace(/["'`]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function hasForbiddenGuidanceVerbs(g) {
      const s = normalizeTextForCompare(g);
      // NON-NEGOTIABLE: Guidance must NEVER contain action verbs (or close variants).
      // This is a comprehensive list of action verbs that should NOT appear in Guidance.
      const actionVerbPattern = /\b(remove|removed|removing|add|added|adding|ensure|ensures|ensuring|include|includes|including|change|changed|changing|provide|provides|providing|submit|submits|submitting|implement|implements|implementing|modify|modifies|modifying|apply|applies|applying|create|creates|creating|delete|deletes|deleting|replace|replaces|replacing|insert|inserts|inserting|document|documents|documenting|obtain|obtains|obtaining|restrict|restricts|restricting|verify|verifies|verifying|check|checks|checking|validate|validates|validating|approve|approves|approving|request|requests|requesting|send|sends|sending|receive|receives|receiving|process|processes|processing|handle|handles|handling|manage|manages|managing|maintain|maintains|maintaining|store|stores|storing|secure|secures|securing|protect|protects|protecting|access|accesses|accessing|share|shares|sharing|disclose|discloses|disclosing|notify|notifies|notifying|inform|informs|informing|communicate|communicates|communicating|publish|publishes|publishing|distribute|distributes|distributing|display|displays|displaying|show|shows|showing|present|presents|presenting|indicate|indicates|indicating|specify|specifies|specifying|state|states|stating|declare|declares|declaring|claim|claims|claiming|assert|asserts|asserting|guarantee|guarantees|guaranteeing|promise|promises|promising|offer|offers|offering|deliver|delivers|delivering|perform|performs|performing|execute|executes|executing|complete|completes|completing|finish|finishes|finishing|start|starts|starting|begin|begins|beginning|initiate|initiates|initiating|launch|launches|launching|establish|establishes|establishing|set|sets|setting|configure|configures|configuring|adjust|adjusts|adjusting|adapt|adapts|adapting|customize|customizes|customizing|personalize|personalizes|personalizing|optimize|optimizes|optimizing|improve|improves|improving|enhance|enhances|enhancing|upgrade|upgrades|upgrading|update|updates|updating|fix|fixes|fixing|repair|repairs|repairing|correct|corrects|correcting|resolve|resolves|resolving|address|addresses|addressing|solve|solves|solving|prevent|prevents|preventing|avoid|avoids|avoiding|eliminate|eliminates|eliminating|reduce|reduces|reducing|minimize|minimizes|minimizing|maximize|maximizes|maximizing|increase|increases|increasing|decrease|decreases|decreasing|expand|expands|expanding|extend|extends|extending|limit|limits|limiting|restrict|restricts|restricting|allow|allows|allowing|permit|permits|permitting|enable|enables|enabling|disable|disables|disabling|activate|activates|activating|deactivate|deactivates|deactivating|turn|turns|turning|switch|switches|switching|toggle|toggles|toggling|open|opens|opening|close|closes|closing|lock|locks|locking|unlock|unlocks|unlocking|save|saves|saving|load|loads|loading|export|exports|exporting|import|imports|importing|upload|uploads|uploading|download|downloads|downloading|copy|copies|copying|paste|pastes|pasting|cut|cuts|cutting|move|moves|moving|transfer|transfers|transferring|assign|assigns|assigning|allocate|allocates|allocating|distribute|distributes|distributing|spread|spreads|spreading|divide|divides|dividing|split|splits|splitting|merge|merges|merging|combine|combines|combining|join|joins|joining|connect|connects|connecting|link|links|linking|attach|attaches|attaching|detach|detaches|detaching|separate|separates|separating|isolate|isolates|isolating|integrate|integrates|integrating|synchronize|synchronizes|synchronizing|coordinate|coordinates|coordinating|align|aligns|aligning|match|matches|matching|compare|compares|comparing|contrast|contrasts|contrasting|analyze|analyzes|analyzing|evaluate|evaluates|evaluating|assess|assesses|assessing|measure|measures|measuring|calculate|calculates|calculating|compute|computes|computing|determine|determines|determining|identify|identifies|identifying|recognize|recognizes|recognizing|detect|detects|detecting|discover|discovers|discovering|find|finds|finding|locate|locates|locating|search|searches|searching|filter|filters|filtering|sort|sorts|sorting|organize|organizes|organizing|arrange|arranges|arranging|structure|structures|structuring|format|formats|formatting|style|styles|styling|design|designs|designing|develop|develops|developing|build|builds|building|construct|constructs|constructing|create|creates|creating|generate|generates|generating|produce|produces|producing|manufacture|manufactures|manufacturing|make|makes|making|do|does|doing)\b/i;
      return actionVerbPattern.test(s);
    }
    
    function hasDisallowedReasoningLanguageInFix(f) {
      const s = normalizeTextForCompare(f);
      // Reject causal/benefit/risk/regulatory reasoning language.
      return /\b(because|so that|in order to|to avoid|to prevent|to reduce|this will|this helps|so you|so users|benefit|benefits|risk|risks|harm|harms|mislead|misleading|regulator|regulatory|intent|penalty|enforcement|compliance|guideline|rules?)\b/i.test(s);
    }

    function hasInstructionVerbInRewrite(f) {
      const s = normalizeTextForCompare(f);
      // Reject instructional verbs; replacement text must be copy-ready, not instructions.
      return /\b(remove|delete|ensure|add|include|revise|rewrite|insert|limit|restrict|verify|document|obtain|disable|update|configure|avoid|prevent|disclose)\b/i.test(s);
    }

    function parseRewriteOptions(fixText) {
      const raw = (fixText || '').toString().trim();
      if (!raw) return null;

      // Work on the main-language part only (translation line is handled separately).
      // Support both "Option A:" and "Option 1:" formats for backward compatibility
      const m1 = /Option\s*(?:A|1)\s*[:\-]\s*["']?([\s\S]*?)["']?(?=\n\s*Option\s*(?:B|2)\s*[:\-]|\n\s*\(English translation:|$)/i.exec(raw);
      const m2 = /Option\s*(?:B|2)\s*[:\-]\s*["']?([\s\S]*?)["']?(?=\n\s*\(English translation:|$)/i.exec(raw);
      if (!m1 || !m2) return null;

      const opt1 = (m1[1] || '').trim().replace(/^["']+|["']+$/g, '');
      const opt2 = (m2[1] || '').trim().replace(/^["']+|["']+$/g, '');
      if (!opt1 || !opt2) return null;

      return { opt1, opt2 };
    }

    function isRewriteOptionsFix(fixText, evidenceText) {
      if (!fixText || typeof fixText !== 'string') return false;
      const text = fixText.trim();
      if (!text) return false;

      // Language enforcement for non-English: must have a translation line, but main body must be in detected language.
      const needsEnglishTranslation = detectedLang !== 'en';
      if (needsEnglishTranslation && !hasEnglishTranslationLine(text)) return false;

      const mainBody = needsEnglishTranslation ? stripEnglishTranslationLine(text) : text;
      const opts = parseRewriteOptions(mainBody);
      if (!opts) return false;

      // Main body must be in detected language (best-effort).
      if (detectedLang === 'hi') {
        const devanagariCount = (mainBody.match(/[\u0900-\u097F]/g) || []).length;
        if (devanagariCount < 10) return false;
      }

      // Reject reasoning and instruction verbs.
      if (hasDisallowedReasoningLanguageInFix(mainBody)) return false;
      if (hasInstructionVerbInRewrite(mainBody)) return false;

      // Ensure options are grounded in evidence (some lexical overlap) but not identical.
      const ev = (evidenceText || '').toString();
      const o1 = opts.opt1;
      const o2 = opts.opt2;
      const sim1 = jaccardSimilarity(ev, o1);
      const sim2 = jaccardSimilarity(ev, o2);
      if (sim1 < 0.10 || sim2 < 0.10) return false;
      if (sim1 > 0.90 || sim2 > 0.90) return false;

      return true;
    }
    
    function hasWhyLanguageInFix(f) {
      const s = normalizeTextForCompare(f);
      return /\b(because|so that|in order to|to avoid|to prevent|to reduce|this violates|regulators|regulatory|intent|harm|risk|misleading|benefit|this will|this helps)\b/i.test(s);
    }

    function hasIntentOrHarmLanguageInFix(f) {
      const s = normalizeTextForCompare(f);
      // Fix must NOT explain regulatory intent/harm.
      return /\b(regulator|regulatory|intent|harm|risk|mislead|misleading|patient|patients|consumer|consumers|public|unsafe|penalt|enforcement|benefit|benefits|helps|helpful|compliance)\b/i.test(s);
    }

    function jaccardSimilarity(a, b) {
      const A = new Set(normalizeTextForCompare(a).split(' ').filter(Boolean));
      const B = new Set(normalizeTextForCompare(b).split(' ').filter(Boolean));
      if (A.size === 0 || B.size === 0) return 0;
      let inter = 0;
      for (const t of A) if (B.has(t)) inter++;
      const union = A.size + B.size - inter;
      return union === 0 ? 0 : inter / union;
    }

    function violatesSeparation(issue) {
      const evidence = (issue?.evidence || '').toString();
      const guidance = (issue?.guidance || '').toString();
      const fix = (issue?.recommended_fix || issue?.recommendation || '').toString();

      // HARD: Guidance and Fix must be distinct. If similarity > 0.15 (15%), discard and regenerate.
      const overlapEG = jaccardSimilarity(evidence, guidance);
      const overlapGF = jaccardSimilarity(guidance, fix);
      const overlapEF = jaccardSimilarity(evidence, fix);

      const badEvidence = isBadEvidence(issue?.evidence);
      const needsEnglishTranslation = detectedLang !== 'en';
      const weakGuidance =
        isWeakGuidance(issue?.guidance) ||
        hasForbiddenGuidanceVerbs(guidance) ||
        overlapEG >= 0.35 ||
        (needsEnglishTranslation && !hasEnglishTranslationLine(guidance)) ||
        // language check (best effort): if Hindi input, guidance must have Hindi body text
        (detectedLang === 'hi' && (stripEnglishTranslationLine(guidance).match(/[\u0900-\u097F]/g) || []).length < 10);

      const weakFix =
        isWeakRecommendation(fix) ||
        hasDisallowedReasoningLanguageInFix(fix) ||
        hasWhyLanguageInFix(fix) ||
        hasIntentOrHarmLanguageInFix(fix) ||
        !isRewriteOptionsFix(fix, evidence) ||
        (needsEnglishTranslation && !hasEnglishTranslationLine(fix)) ||
        (detectedLang === 'hi' && (stripEnglishTranslationLine(fix).match(/[\u0900-\u097F]/g) || []).length < 10);

      // SIMILARITY GUARD: Regenerate if Guidance and Fix are semantically overlapping (0.75 threshold)
      // This ensures Guidance (WHY) and Recommended Fix (HOW) are meaningfully different
      const tooSimilarGuidanceFix = overlapGF > 0.75; // 0.75 threshold - regenerate if highly similar/identical
      // Evidence and fix will overlap (rewrite), but must not be identical.
      const tooSimilarEvidenceFix = overlapEF > 0.90;

      return {
        badEvidence,
        weakGuidance,
        weakFix,
        tooSimilarGuidanceFix,
        tooSimilarEvidenceFix,
        overlapEG,
        overlapGF,
        overlapEF
      };
    }

    function hasCrossIssueRepetition(issues) {
      const seenGuidance = [];
      const seenFix = [];
      for (const it of issues) {
        const g = (it?.guidance || '').toString();
        const f = (it?.recommended_fix || it?.recommendation || '').toString();
        for (const prev of seenGuidance) {
          if (jaccardSimilarity(prev, g) >= 0.75) return true;
        }
        for (const prev of seenFix) {
          if (jaccardSimilarity(prev, f) >= 0.75) return true;
        }
        seenGuidance.push(g);
        seenFix.push(f);
      }
      return false;
    }

    // Regenerate ONLY Recommended Fix when similarity with Guidance is too high (>0.75)
    async function regenerateOnlyFix({ issue, idx, priorAccepted }) {
      const fixedEvidence = (issue?.evidence || '').toString();
      const rulePack = (issue?.rule_pack || '').toString().trim() || deriveRulePack(issue?.law_reference || issue?.regulation);
      const violation = (issue?.violation || '').toString().trim();
      const severity = (issue?.severity || '').toString();
      const guidance = (issue?.guidance || '').toString().trim(); // Keep existing guidance

      // Provide "do-not-use" phrases to enforce uniqueness across issues.
      const priorFixes = priorAccepted.map(x => (x.recommended_fix || '').toString()).filter(Boolean).slice(-6);

      const regenPrompt = `You are a senior compliance officer. Rewrite ONLY the recommended_fix for ONE issue.

CRITICAL RULES:
- Evidence must remain EXACTLY as provided.
- Guidance (provided below) must remain EXACTLY as provided - DO NOT change it.
- Recommended Fix MUST rewrite the Evidence into compliant replacement text (what it should say instead).
- Output MUST be exactly two alternatives in this exact format:
  RECOMMENDED FIX
  Option A:
  "<single compliant replacement line>"
  
  Option B:
  "<alternative compliant replacement line>"
- Each option MUST be a single compliant replacement line for the exact evidence text.
- Do NOT explain why the line is wrong.
- Do NOT give steps, guidance, or regulatory reasoning.
- Each option must directly replace the original problematic sentence.
- No bullets. No paragraphs. No generic advice.
- No bullets. No numbering. No instructions. No explanations.
- Do NOT use instructional verbs (remove/delete/add/ensure/include/revise/limit/etc.).
- Do NOT include: because, so that, in order to, to avoid, to prevent, to reduce, regulator, regulatory, intent, harm, risk, misleading, penalty, enforcement, compliance.
- Keep the options in the detected input language. Do NOT translate.
- Recommended Fix MUST be meaningfully different from Guidance (similarity must be < 0.75).
- Do NOT reuse any phrasing or sentence structure from prior fixes provided.

RULE PACK: ${rulePack}
SEVERITY: ${severity}
VIOLATION: ${violation}
EVIDENCE (LOCKED): ${fixedEvidence}
GUIDANCE (LOCKED - DO NOT CHANGE): ${guidance}

PRIOR FIXES (do NOT reuse wording/structure):
${priorFixes.length ? priorFixes.map((f,i)=>`- ${i+1}. ${f}`).join('\n') : '- (none)'}

Return STRICT JSON ONLY:
{
  "recommended_fix": "..."
}`;

      const repairedText = await callAuditOnce(regenPrompt);
      const repaired = JSON.parse(repairedText);
      return {
        ...issue,
        rule_pack: rulePack,
        guidance: guidance, // Keep original guidance unchanged
        recommended_fix: (repaired?.recommended_fix || '').toString().trim()
      };
    }

    async function regenerateOneIssue({ issue, idx, priorAccepted }) {
      const fixedEvidence = (issue?.evidence || '').toString();
      const rulePack = (issue?.rule_pack || '').toString().trim() || deriveRulePack(issue?.law_reference || issue?.regulation);
      const violation = (issue?.violation || '').toString().trim();
      const severity = (issue?.severity || '').toString();

      // Provide "do-not-use" phrases to enforce uniqueness across issues.
      const priorGuidance = priorAccepted.map(x => (x.guidance || '').toString()).filter(Boolean).slice(-6);
      const priorFixes = priorAccepted.map(x => (x.recommended_fix || '').toString()).filter(Boolean).slice(-6);

      const regenPrompt = `You are a senior compliance officer. Rewrite ONLY guidance and recommended_fix for ONE issue.

HARD RULES:
- Evidence must remain EXACTLY as provided.
- Guidance must be ONLY the WHY (rule intent + harm). Guidance MUST NOT contain ANY action verbs (remove, add, ensure, include, change, provide, submit, implement, etc.).
- Recommended Fix must be ONLY replacement text (WHAT IT SHOULD SAY INSTEAD), derived directly from Evidence.
- Output MUST be exactly two alternatives in this exact format:
  RECOMMENDED FIX
  Option A:
  "<single compliant replacement line>"
  
  Option B:
  "<alternative compliant replacement line>"
- Each option MUST be a single compliant replacement line for the exact evidence text.
- Do NOT explain why the line is wrong.
- Do NOT give steps, guidance, or regulatory reasoning.
- Each option must directly replace the original problematic sentence.
- No bullets. No paragraphs. No generic advice.
- No bullets. No numbering. No instructions. No explanations.
- Do NOT use instructional verbs (remove/delete/add/ensure/include/revise/limit/etc.).
- Do NOT include intent/harm/risk/regulatory reasoning language (avoid: regulator, regulatory, intent, harm, risk, misleading, penalty, enforcement, compliance).
- Guidance and Recommended Fix must NOT be similar. Similarity must be < 0.75.
- Do NOT reuse any phrasing or sentence structure from prior items provided.

RULE PACK: ${rulePack}
SEVERITY: ${severity}
VIOLATION: ${violation}
EVIDENCE (LOCKED): ${fixedEvidence}

PRIOR GUIDANCE (do NOT reuse wording/structure):
${priorGuidance.length ? priorGuidance.map((g,i)=>`- ${i+1}. ${g}`).join('\n') : '- (none)'}

PRIOR FIXES (do NOT reuse wording/structure):
${priorFixes.length ? priorFixes.map((f,i)=>`- ${i+1}. ${f}`).join('\n') : '- (none)'}

Return STRICT JSON ONLY:
{
  "guidance": "...",
  "recommended_fix": "..."
}`;

      const repairedText = await callAuditOnce(regenPrompt);
      const repaired = JSON.parse(repairedText);
      return {
        ...issue,
        rule_pack: rulePack,
        guidance: (repaired?.guidance || '').toString().trim(),
        recommended_fix: (repaired?.recommended_fix || '').toString().trim()
      };
    }

    // Per-issue enforcement with self-validation + uniqueness across issues.
    const issues = Array.isArray(auditResult?.issues) ? auditResult.issues : [];
    if (issues.length > 0) {
      const accepted = [];
      const updated = [];

      for (let i = 0; i < issues.length; i++) {
        let issue = issues[i];

        // Ensure rule_pack always present before any regeneration prompts.
        const lawRef = (issue?.law_reference || issue?.regulation || '').toString();
        issue = { ...issue, rule_pack: (issue?.rule_pack || '').toString().trim() || deriveRulePack(lawRef) };

        for (let attempt = 1; attempt <= 4; attempt++) {
          const v = violatesSeparation(issue);
          // REGENERATION GUARD: Only check for cross-issue repetition if highly similar (40% threshold)
          // This reduces unnecessary regenerations that cause instability
          const crossRepeat =
            accepted.some((a) => jaccardSimilarity(a.guidance, issue.guidance) > 0.40) || // 40% threshold - only if highly similar
            accepted.some((a) => jaccardSimilarity(a.recommended_fix, issue.recommended_fix) > 0.40); // 40% threshold - only if highly similar

          // SIMILARITY GUARD: If Guidance and Fix are too similar (>0.75), regenerate ONLY Recommended Fix
          // This ensures semantic separation while preserving good Guidance
          if (v.tooSimilarGuidanceFix && !v.badEvidence && !v.weakGuidance) {
            console.warn(`⚠️  Issue ${i + 1} Guidance and Fix too similar (${(v.overlapGF * 100).toFixed(0)}%). Regenerating ONLY Recommended Fix...`);
            try {
              issue = await regenerateOnlyFix({ issue, idx: i, priorAccepted: accepted });
              // Re-check after regeneration
              const vAfter = violatesSeparation(issue);
              if (!vAfter.tooSimilarGuidanceFix && !vAfter.weakFix) {
                break; // Success - only fix was regenerated and is properly formatted
              }
            } catch (e) {
              console.warn(`⚠️  Failed to regenerate only fix, falling back to full regeneration: ${e.message}`);
            }
          }

          const needRegen =
            v.badEvidence ||
            v.weakGuidance ||
            v.weakFix ||
            v.tooSimilarEvidenceFix ||
            crossRepeat;

          if (!needRegen) break;

          console.warn(`⚠️  Issue ${i + 1} failed quality gate (attempt ${attempt}). Regenerating guidance/fix...`);
          try {
            issue = await regenerateOneIssue({ issue, idx: i, priorAccepted: accepted });
          } catch (e) {
            // If regeneration fails, keep current and fall back later.
            break;
          }
        }

        // Final backstop: ensure we never return identical guidance/fix.
        // SIMILARITY GUARD: Reject output if Guidance and Fix convey the same meaning (>0.75 threshold)
        const finalOverlap = jaccardSimilarity(issue.guidance, issue.recommended_fix);
        if (finalOverlap > 0.75) { // 0.75 threshold - reject if semantically overlapping
          console.warn(`⚠️  Final check: Issue ${i + 1} Guidance and Fix still too similar (${(finalOverlap * 100).toFixed(0)}%). Forcing distinct versions...`);
          // Try regenerating only the fix first (preserve good guidance)
          try {
            const regenerated = await regenerateOnlyFix({ issue, idx: i, priorAccepted: accepted });
            const overlapAfter = jaccardSimilarity(regenerated.guidance, regenerated.recommended_fix);
            if (overlapAfter <= 0.75 && isRewriteOptionsFix(regenerated.recommended_fix, regenerated.evidence)) {
              issue = regenerated;
            } else {
              // If regeneration fails, force distinctness using fallbacks
              const rp = (issue.rule_pack || '').toString().trim() || 'General';
              issue = {
                ...issue,
                guidance: deriveGuidanceFallback({ rulePack: rp }),
                recommended_fix: deriveRecommendationFallback({ ...issue, rule_pack: rp })
              };
            }
          } catch (e) {
            // If regeneration fails, force distinctness using fallbacks
            const rp = (issue.rule_pack || '').toString().trim() || 'General';
            issue = {
              ...issue,
              guidance: deriveGuidanceFallback({ rulePack: rp }),
              recommended_fix: deriveRecommendationFallback({ ...issue, rule_pack: rp })
            };
          }
        }
        
        // VALIDATION: Ensure Recommended Fix is rewrite-options grounded in evidence (no instructions/explanations)
        if (!isRewriteOptionsFix(issue.recommended_fix, issue.evidence)) {
          console.warn(`⚠️  Issue ${i + 1} Recommended Fix failed rewrite-options validation. Regenerating...`);
          try {
            issue = await regenerateOnlyFix({ issue, idx: i, priorAccepted: accepted });
            // Re-validate after regeneration
            if (!isRewriteOptionsFix(issue.recommended_fix, issue.evidence)) {
              // If still invalid, use fallback options (copy-ready)
              const rp = (issue.rule_pack || '').toString().trim() || 'General';
              const fallbackFix = deriveRecommendationFallback({ ...issue, rule_pack: rp });
              issue = {
                ...issue,
                recommended_fix: fallbackFix
              };
            }
          } catch (e) {
            // If regeneration fails, use fallback options (copy-ready)
            const rp = (issue.rule_pack || '').toString().trim() || 'General';
            const fallbackFix = deriveRecommendationFallback({ ...issue, rule_pack: rp });
            issue = {
              ...issue,
              recommended_fix: fallbackFix
            };
          }
        }

        accepted.push({
          guidance: issue.guidance,
          recommended_fix: issue.recommended_fix
        });
        updated.push(issue);
      }

      auditResult.issues = updated;
    }

    // Normalize to the UI-friendly/legacy structure while preserving strict per-issue schema internally.
    // IMPORTANT (UI compatibility):
    // - Do NOT add/remove fields consumed by UI.
    // - Enforce required headings/order by formatting existing text fields.
    const finalIssues = Array.isArray(auditResult?.issues) ? auditResult.issues : [];

    // Ensure all issues have English translations before normalizing (fail-safe)
    const client = getOpenAIClient();
    const normalizedViolations = await Promise.all(finalIssues.map(async (it, idx) => {
      const severity = toTitleSeverity(it?.severity);
      const lawRef = (it?.law_reference || '').toString().trim() || 'Regulatory reference required';
      const rulePack = (it?.rule_pack || '').toString().trim() || deriveRulePack(lawRef);
      let violation = (it?.violation || '').toString().trim() || 'Compliance issue detected';
      let evidence = (it?.evidence || '').toString().trim();
      let guidance = (it?.guidance || '').toString().trim();
      let recommendation =
        (it?.recommended_fix || it?.recommendation || '').toString().trim();

      if (isBadEvidence(evidence)) {
        evidence = deriveEvidenceFallback(it);
      }
      if (isWeakGuidance(guidance)) {
        // Guidance fallback must be explanatory only (no actions)
        guidance = deriveGuidanceFallback({ rulePack });
      }
      if (isWeakRecommendation(recommendation)) {
        // Fix fallback must be actionable steps (no "why")
        recommendation = deriveRecommendationFallback({ ...it, rule_pack: rulePack });
      }

      // Ensure English translations are present for ALL sections (violation, evidence, guidance, recommended_fix)
      // Fail-safe: if missing, generate translations
      if (detectedLang !== 'en') {
        if (!hasEnglishTranslationLine(violation)) {
          violation = await ensureEnglishTranslation(violation, detectedLang, client, systemPrompt, 'violation');
        }
        if (!hasEnglishTranslationLine(evidence)) {
          evidence = await ensureEnglishTranslation(evidence, detectedLang, client, systemPrompt, 'evidence');
        }
        if (!hasEnglishTranslationLine(guidance)) {
          guidance = await ensureEnglishTranslation(guidance, detectedLang, client, systemPrompt, 'guidance');
        }
        if (!hasEnglishTranslationLine(recommendation)) {
          recommendation = await ensureEnglishTranslation(recommendation, detectedLang, client, systemPrompt, 'recommended_fix');
        }
      }

      // OUTPUT STRUCTURE LOCK (MANDATORY - DO NOT MODIFY ORDER OR FIELD NAMES):
      // This structure is locked to ensure consistent output across all audit runs.
      // Changing field order or names will break UI compatibility and cause instability.
      // 
      // Fixed order (MUST NOT CHANGE):
      // 1) Severity badge + Rule Pack (in `regulation` field)
      // 2) Violation description (in `description` field)
      // 3) EVIDENCE / URL (in `problematicContent` field)
      // 4) GUIDANCE (in `suggestion` field - used by ScreenAuditor UI)
      // 5) RECOMMENDED FIX (in `solution` field)
      // 
      // Headings must match exactly (case + spacing) for UI compatibility.
      // Field names are part of the API contract - DO NOT rename.
      const formattedEvidence = ['EVIDENCE / URL', evidence].join('\n').trim();
      const formattedGuidance = ['GUIDANCE', guidance].join('\n').trim();
      // Ensure recommendation already has RECOMMENDED FIX header, if not add it
      let formattedFix = recommendation;
      if (!recommendation.includes('RECOMMENDED FIX')) {
        formattedFix = ['RECOMMENDED FIX', recommendation].join('\n').trim();
      }

      // Frontend EmailAuditor expects: problematicContent + solution (strings)
      // Structure order: Severity+RulePack → Violation → Evidence → Guidance → Recommended Fix
      // DO NOT reorder fields or change field names - this breaks UI compatibility
      return {
        severity, // 1) Severity badge (MANDATORY - UI expects this field)
        regulation: `${rulePack} / ${lawRef}`, // 1) Rule Pack (MANDATORY - UI expects this field)
        description: violation, // 2) Violation description (MANDATORY - UI expects this field)
        evidence, // Raw evidence stored separately (for internal use)
        recommended_fix: recommendation, // Raw fix stored separately (for internal use)
        problematicContent: formattedEvidence, // 3) EVIDENCE / URL (MANDATORY - UI expects this field)
        suggestion: formattedGuidance, // 4) GUIDANCE (MANDATORY - ScreenAuditor UI reads this)
        solution: formattedFix, // 5) RECOMMENDED FIX (MANDATORY - UI expects this field)
        index: idx + 1 // Index for ordering (MANDATORY - UI expects this field)
      };
    }));

    const recommendedActions = Array.isArray(auditResult?.recommended_actions) ? auditResult.recommended_actions : [];
    const derivedActions = normalizedViolations
      .map(v => v.solution)
      .filter(Boolean)
      .slice(0, 5);

    // Calculate deterministic risk_score from violations (function defined earlier in cache section)
    const deterministicRiskScore = calculateDeterministicRiskScore(normalizedViolations);
    const deterministicRiskLevel = deterministicRiskScore >= 70 ? 'High' : deterministicRiskScore >= 40 ? 'Medium' : 'Low';

    // FINAL RESULT STRUCTURE LOCK (MANDATORY - DO NOT MODIFY FIELD ORDER):
    // This structure is locked to ensure consistent output across all audit runs.
    // Field order and names are part of the API contract - DO NOT change.
    const finalResult = {
      risk_level: deterministicRiskLevel, // MANDATORY - UI expects this field
      risk_score: deterministicRiskScore, // MANDATORY - Deterministic calculation (not AI-generated)
      compliance_flags: Array.isArray(auditResult.compliance_flags) ? auditResult.compliance_flags : [], // MANDATORY - UI expects this field
      summary: auditResult.summary || auditResult.explanation || 'Audit completed', // MANDATORY - UI expects this field
      recommended_actions: recommendedActions.length > 0 ? recommendedActions : derivedActions, // MANDATORY - UI expects this field
      detected_content_types: Array.isArray(auditResult.detected_content_types) ? auditResult.detected_content_types : ['text'], // MANDATORY - UI expects this field
      violations: normalizedViolations, // MANDATORY - UI expects this field (locked structure from above)
      status: deterministicRiskScore >= 70 ? 'NON_COMPLIANT' : 'COMPLIANT', // MANDATORY - UI expects this field
      explanation: auditResult.explanation || auditResult.summary || 'Audit completed', // MANDATORY - UI expects this field
      recommended_fix: derivedActions[0] || auditResult.recommended_actions?.[0] || 'Remove or rewrite the specific risky statements and add required disclosures.' // MANDATORY - UI expects this field
    };

    // Store audit result with hash for deterministic caching (async, don't block)
    try {
      const Audit = (await import('../models/Audit.js')).default;
      const auditDoc = {
        userId: metadata.userId || 'system',
        sourceType: 'email',
        sourceId: metadata.emailId || `email-${Date.now()}`,
        sourceMetadata: {
          emailId: metadata.emailId,
          subject: metadata.subject,
          sender: metadata.sender || metadata.from,
          hasAttachments: attachments.length > 0
        },
        extractedText: auditInput.substring(0, 10000), // Store first 10k chars
        auditResult: finalResult,
        status: 'completed',
        inputHash, // Store hash for cache lookup
        openaiResponse: auditResult,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Save without blocking (fire and forget for performance)
      Audit.create(auditDoc).catch(err => {
        console.warn(`⚠️  Failed to cache audit result: ${err.message}`);
      });
    } catch (cacheError) {
      console.warn(`⚠️  Cache storage failed (non-blocking): ${cacheError.message}`);
    }

    console.log(`✅ runOpenAIAudit executed successfully`);
    console.log(`   Issues found: ${normalizedViolations.length}`);
    console.log(`   Risk Level: ${finalResult.risk_level}`);
    console.log(`   Risk Score: ${finalResult.risk_score}`);

    return finalResult;
  } catch (error) {
    console.error(`❌ OpenAI audit failed:`, error.message);
    throw error;
  }
}

/**
 * Transcribe audio/video using OpenAI Whisper API
 * 
 * Uses model: whisper-1
 * MANDATORY: Always transcribes in original spoken language (no translation)
 * 
 * @param {Buffer} audioBuffer - Audio/video file buffer
 * @param {string} filename - Original filename
 * @param {Object} options - Optional options { mimeType, throwOnError }
 * @returns {Promise<string>} Transcribed text in original language
 */
export async function transcribeWithWhisper(audioBuffer, filename, options = {}) {
  // Validate API key
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OPENAI_API_KEY environment variable is not set');
    error.code = 'MISSING_API_KEY';
    throw error;
  }

  // Parse options (support both new signature and legacy arguments)
  const mimeTypeHint = options?.mimeType;
  const throwOnError = !!options?.throwOnError;

  const isBuffer = Buffer.isBuffer(audioBuffer);
  const isPath = typeof audioBuffer === 'string' && audioBuffer.length > 0;

  if (!isBuffer && !isPath) {
    const error = new Error('Audio input must be a Buffer or a file path string');
    error.code = 'INVALID_INPUT';
    if (throwOnError) throw error;
    return `[Transcription failed for ${filename}: ${error.message}]`;
  }

  // Temp file bookkeeping (so we can always clean up)
  let tempInputPath = null;
  let tempExtractedAudioPath = null;

  try {
    console.log(`📤 Calling OpenAI Whisper API`);
    console.log(`   Model: whisper-1`);
    console.log(`   File: ${filename}`);
    if (isBuffer) {
      console.log(`   Size: ${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    }
    
    // Get OpenAI client
    const client = getOpenAIClient();

    const ext = (path.extname(filename || '') || '').toLowerCase();
    const hinted = (mimeTypeHint || '').toString().toLowerCase();
    const isVideo = hinted.startsWith('video/') || ['.mp4', '.mov', '.avi', '.webm', '.mkv'].includes(ext);

    // Ensure we provide OpenAI SDK with a real file stream (fs.createReadStream),
    // as some stream hacks do not work reliably across environments.
    const tempDir = path.join(os.tmpdir(), 'satark-whisper');
    const baseName = `${Date.now()}-${randomUUID()}`;
    const inputExt = ext || (isVideo ? '.mp4' : '.mp3');
    const inputPath = isBuffer ? path.join(tempDir, `${baseName}${inputExt}`) : audioBuffer;

    if (isBuffer) {
      await fse.ensureDir(tempDir);
      await fse.writeFile(inputPath, audioBuffer);
      tempInputPath = inputPath;
    }

    let fileToTranscribe = inputPath;

    // If it's a video and ffmpeg is available, extract an audio-only file first.
    if (isVideo) {
      console.log(`🎬 Video received; preparing audio for Whisper...`);
      if (hasFfmpeg()) {
        console.log(`🔊 Extracting audio stream via ffmpeg`);
        tempExtractedAudioPath = path.join(tempDir, `${baseName}.mp3`);
        await runFfmpegExtractAudio({ inputPath, outputPath: tempExtractedAudioPath });
        fileToTranscribe = tempExtractedAudioPath;
      } else {
        console.warn(`⚠️  ffmpeg not found on PATH; sending video file directly to Whisper`);
      }
    }

    console.log(`🎤 Whisper transcription started`);
    console.log(`   Mode: transcribe (original language, no translation)`);
    const fileStream = fs.createReadStream(fileToTranscribe);

    // MANDATORY WHISPER RULES:
    // 1. Use task = "transcribe" to transcribe in original language
    // 2. Do NOT use task = "translate" (which translates to English)
    // 3. Do NOT force language = "en" (allows auto-detection of spoken language)
    // 4. Use verbose_json to get detected language for downstream audit logic
    const transcription = await client.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      task: 'transcribe', // MANDATORY: transcribe (not translate)
      response_format: 'verbose_json' // Get language detection info
    });

    // Extract text and detected language
    const text = transcription.text || '';
    const detectedLanguage = transcription.language || null;
    
    if (detectedLanguage) {
      console.log(`   Detected language: ${detectedLanguage}`);
    } else {
      console.log(`   Language: auto-detected (not specified in response)`);
    }

    if (!text || text.trim().length === 0) {
      console.warn(`⚠️  Whisper returned empty transcription for ${filename}`);
      return `[No speech detected in ${filename}]`;
    }

    console.log(`✅ Whisper transcription completed (${text.length} characters)`);
    if (detectedLanguage) {
      console.log(`   Transcript is in: ${detectedLanguage}`);
    }
    return text.trim();
  } catch (error) {
    // Determine error code
    if (!error.code) {
      if (error.message && (error.message.includes('API key') || error.message.includes('authentication'))) {
        error.code = 'AUTHENTICATION_ERROR';
      } else if (error.message && (error.message.includes('file') || error.message.includes('format'))) {
        error.code = 'FILE_ERROR';
      } else if (error.message && (error.message.includes('quota') || error.message.includes('rate limit'))) {
        error.code = 'RATE_LIMIT_ERROR';
      } else {
        error.code = 'WHISPER_API_ERROR';
      }
    }

    console.error(`❌ Whisper API error:`);
    console.error(`   Error Code: ${error.code || 'UNKNOWN'}`);
    console.error(`   Error Message: ${error.message || 'Unknown error'}`);
    console.error(`   File: ${filename}`);

    if (throwOnError) {
      throw error;
    }

    // Return a fallback message instead of throwing (used by best-effort pipelines)
    return `[Transcription failed for ${filename}: ${error.message}]`;
  } finally {
    // Cleanup temp files we created
    try {
      if (tempExtractedAudioPath) {
        await fse.remove(tempExtractedAudioPath);
      }
      if (tempInputPath) {
        await fse.remove(tempInputPath);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
