// Note: auditText now uses runOpenAIAudit from openaiClient.js
// Remaining functions below are kept for potential backward compatibility

export function detectContentLanguage(text) {
  const s = (text || '').toString();
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

function buildLanguageSystemPrompt({ lang, langName }) {
  // If English, output only in English
  if (lang === 'en') {
    return `SYSTEM POLICY (STRICT):
LANGUAGE CONTROL (NON-NEGOTIABLE):
- All output MUST be written in English only.
- No translations.
- No brackets.
- Keep the same JSON structure.`;
  }
  
  // For audits: do NOT add English translations. Output in detected language only.
  return `SYSTEM POLICY (STRICT):

LANGUAGE CONTROL (NON-NEGOTIABLE):
- All output MUST be written in ${langName}.
- This applies to: risk_level labels, status labels, summary, issues, evidence, guidance, and fixed_line.
- Do NOT mix languages randomly.
- Do NOT add English translations.`;
}

function stripWrappingQuotes(s) {
  return (s || '').toString().trim().replace(/^["'\s]+|["'\s]+$/g, '').trim();
}

function sentenceCount(text) {
  const s = (text || '').toString().trim();
  if (!s) return 0;
  // Count sentences by punctuation; treat Hindi danda as sentence boundary.
  const parts = s.split(/(?<=[.!?।])\s+/).map(p => p.trim()).filter(Boolean);
  return parts.length;
}

function hasAnyActionVerb(text) {
  const s = normalizeTextForCompare(text);
  // Hard ban list focused on "do this" verbs (per user requirements)
  return /\b(verify|ensure|add|remove|maintain|train|document|update|revise|rewrite|include|limit|restrict|disable|configure|implement|collect|store|share|disclose|obtain|provide|use|stop|delete|submit|apply|create|send|notify|check|validate|approve|request)\b/i.test(s);
}

function isGuidanceValid(guidance) {
  const g = (guidance || '').toString().trim();
  if (!g) return false;
  if (sentenceCount(g) > 2) return false;
  if (hasAnyActionVerb(g)) return false;
  // Avoid explicit imperatives or "should/must" which often become advice.
  if (/\b(should|must|need to|please)\b/i.test(g)) return false;
  return true;
}

function looksHindi(text) {
  const s = (text || '').toString();
  return (s.match(/[\u0900-\u097F]/g) || []).length >= 10;
}

function looksEnglish(text) {
  const s = (text || '').toString();
  const devanagari = (s.match(/[\u0900-\u097F]/g) || []).length;
  // Allow digits/punct but reject mixed Hindi content.
  return devanagari === 0;
}

function hasAbsolutesOrGuarantees(text, lang) {
  const s = (text || '').toString().toLowerCase();
  if (lang === 'hi') {
    return /(\b100%\b|गारंटी|गारण्टी|पूर्णतः|पूरी तरह|हमेशा|कभी नहीं|स्थायी|तुरंत|अचूक|पक्का|जड़ से|साइड इफेक्ट नहीं)/i.test(s);
  }
  return /\b(100%|guarantee|guaranteed|sure shot|instant|permanent|always|never|no side effects|cure|cures|cured)\b/i.test(s);
}

function isFixedLineValid(fixedLine, lang) {
  const s = (fixedLine || '').toString().trim();
  if (!s) return false;
  if (s.includes('\n')) return false;
  if (hasAbsolutesOrGuarantees(s, lang)) return false;
  if (lang === 'hi') return looksHindi(s);
  return looksEnglish(s);
}

function splitIntoCandidateLines(inputText) {
  const text = (inputText || '').toString();
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length > 0) return rawLines;
  // Fallback: sentence-ish segmentation
  return text
    .split(/(?<=[.!?।])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function pickBestLineFromText({ inputText, evidenceCandidate, descriptionCandidate }) {
  const MAX_EVIDENCE_CHARS = 250;
  const lines = splitIntoCandidateLines(inputText);
  const cand = stripWrappingQuotes(evidenceCandidate);
  if (cand) {
    const exact = lines.find(l => l.includes(cand));
    if (exact) return exact;
    const normCand = normalizeTextForCompare(cand);
    const approx = lines.find(l => normalizeTextForCompare(l).includes(normCand));
    if (approx) return approx;
  }
  const desc = (descriptionCandidate || '').toString();
  const tokens = desc
    .replace(/[^a-zA-Z0-9\u0900-\u097F\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 4)
    .slice(0, 8);
  if (tokens.length === 0) return lines[0] || '';
  let best = lines[0] || '';
  let bestScore = -1;
  for (const l of lines) {
    const low = l.toLowerCase();
    const score = tokens.reduce((acc, t) => acc + (low.includes(t.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }
  // Enforce single-sentence, short evidence for legal defensibility.
  let candidate = best || '';
  // If the candidate accidentally contains multiple sentences, take the first one.
  const sentenceParts = candidate
    .split(/(?<=[.!?؟!]|।)\s+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (sentenceParts.length > 0) {
    candidate = sentenceParts[0];
  }
  // Hard cap length to 250 characters (trim at word boundary when possible).
  if (candidate.length > MAX_EVIDENCE_CHARS) {
    const sliced = candidate.slice(0, MAX_EVIDENCE_CHARS + 1);
    const lastSpace = sliced.lastIndexOf(' ');
    candidate = (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced.slice(0, MAX_EVIDENCE_CHARS)).trim();
  }
  return candidate;
}

function deterministicFixedLineFallback({ originalLine, lang, isOptionB = false }) {
  const line = (originalLine || '').toString().trim();
  if (lang === 'hi') {
    // Neutral informational fallback (deterministic)
    if (/(100%|गारंटी|गारण्टी|हमेशा|कभी नहीं|स्थायी|तुरंत|अचूक|पक्का)/i.test(line)) {
      return isOptionB 
        ? 'परिणाम व्यक्ति के अनुसार अलग हो सकते हैं, योग्य स्वास्थ्य विशेषज्ञ से परामर्श करें।'
        : 'परिणाम व्यक्ति की चिकित्सकीय स्थिति और क्लिनिकल मूल्यांकन के अनुसार अलग हो सकते हैं।';
    }
    if (/(इलाज|उपचार|ठीक|जड़ से|दावा|क्योर)/i.test(line)) {
      return isOptionB
        ? 'यह जानकारी सामान्य है और चिकित्सकीय सलाह का विकल्प नहीं है।'
        : 'यह जानकारी सामान्य है; निदान और उपचार के लिए योग्य स्वास्थ्य विशेषज्ञ से परामर्श आवश्यक है।';
    }
    return isOptionB
      ? 'योग्य स्वास्थ्य विशेषज्ञ से परामर्श करने की सलाह दी जाती है।'
      : 'अधिक जानकारी के लिए योग्य स्वास्थ्य विशेषज्ञ से परामर्श करें।';
  }

  // English fallbacks
  if (/\b(100%|guarantee|guaranteed|always|never|instant|permanent)\b/i.test(line)) {
    return isOptionB
      ? 'Results may vary by individual and should be evaluated by a healthcare professional.'
      : 'Outcomes vary by individual conditions and clinical evaluation.';
  }
  if (/\b(cure|cures|cured)\b/i.test(line)) {
    return isOptionB
      ? 'This information is general and requires consultation with a qualified healthcare provider.'
      : 'This information is general and is not a substitute for professional medical advice.';
  }
  return isOptionB
    ? 'Individual results may vary. Please consult a qualified healthcare professional.'
    : 'Outcomes vary by individual conditions and clinical evaluation.';
}

function formatRecommendedFixSingle({ originalLine, fixedLine, fixedLineB }) {
  // Generate second option if not provided (variation of first option)
  let optionB = fixedLineB;
  if (!optionB && fixedLine) {
    // Create a slight variation for Option B
    const line = fixedLine.trim();
    if (line.endsWith('.')) {
      optionB = line.slice(0, -1) + ', as advised by a qualified healthcare professional.';
    } else {
      optionB = line + ' Individual results may vary.';
    }
  }
  
  return [
    'RECOMMENDED FIX',
    'Option A:',
    `"${fixedLine || ''}"`,
    '',
    'Option B:',
    `"${optionB || fixedLine || ''}"`
  ].join('\n');
}

function deriveGuidanceFallbackShort({ regulation, lang }) {
  const reg = (regulation || '').toString().toLowerCase();
  if (lang === 'hi') {
    if (reg.includes('dpdp') || reg.includes('data')) {
      return 'यह पंक्ति बिना स्पष्ट उद्देश्य/सहमति के व्यक्तिगत डेटा के उपयोग का संकेत देती है, जिससे गोपनीयता और दुरुपयोग का जोखिम बढ़ता है। नियामक ढांचा डेटा-सुरक्षा और उपयोगकर्ता-संरक्षण पर केंद्रित है।';
    }
    return 'यह पंक्ति अतिरंजित/निश्चित परिणाम का संकेत देती है, जिससे मरीज भ्रामक अपेक्षाएँ बना सकते हैं। स्वास्थ्य विज्ञापन मानक उपभोक्ता सुरक्षा और गैर-भ्रामक संचार पर आधारित हैं।';
  }
  if (reg.includes('dpdp') || reg.includes('data')) {
    return 'This line indicates personal data handling without clear purpose/consent, which undermines privacy protections and increases misuse risk. Data protection rules focus on preventing harm from unlawful or excessive processing.';
  }
  return 'This line presents an absolute or misleading claim that can distort patient expectations and decision-making. Healthcare advertising standards aim to prevent consumer harm from overpromising outcomes.';
}

async function runRewriteAudit({ inputText, sourceType, metadata = {} }) {
  const detectedLang = detectContentLanguage(inputText);
  const langName = languageName(detectedLang);
  const systemPrompt = buildLanguageSystemPrompt({ lang: detectedLang, langName });
  const { getOpenAIClient } = await import('./openaiClient.js');
  const client = getOpenAIClient();

  const prompt = `You are a compliance auditor for Indian healthcare advertising and data protection.

TASK:
- Identify compliance issues in the content.
- For EACH issue:
  1) evidence_line: MUST be a SINGLE sentence or the shortest phrase that directly triggered the issue, quoted verbatim from the content (no paraphrase).
  2) guidance: 1–2 sentences explaining WHY the evidence_line is non-compliant (regulatory intent + user harm). DO NOT suggest any actions. Do NOT use action verbs like verify/ensure/add/remove/maintain/train/document/etc.
  3) fixed_line: Rewrite the SAME evidence_line into a compliant, safe replacement line in the SAME language as the content. No guarantees, no absolutes, no promises. Must sound like real marketing copy, not policy text.
  4) fixed_line_b: Provide an ALTERNATIVE compliant replacement line (different wording, same meaning) in the SAME language. This is Option B.
- If a line cannot be safely rewritten, fixed_line and fixed_line_b must be neutral informational lines (still same language).

STRICT RULES FOR EVIDENCE_LINE (MANDATORY):
- MUST be at most 250 characters.
- MUST NOT contain more than one sentence.
- MUST NOT contain line breaks or paragraphs.
- MUST NOT include surrounding context or the full transcript.
- If the risky content spans multiple sentences, choose ONLY the single most representative sentence or the shortest triggering phrase (<= 250 chars).

STRICT RULES FOR FIXED LINES:
- Each fixed_line must be a SINGLE line (no line breaks, no paragraphs)
- Do NOT explain why the line is wrong
- Do NOT give steps, guidance, or regulatory reasoning
- Each option must directly replace the original problematic sentence
- No bullet points, no paragraphs, no generic advice
- Both options must be in the SAME language as the detected content

LANGUAGE RULE (NON-NEGOTIABLE):
- Output ONLY in ${langName}. Do NOT mix languages. Do NOT add translations.

Return STRICT JSON ONLY with this schema:
{
  "summary": "1-2 sentence overall summary",
  "issues": [
    {
      "severity": "LOW" | "MEDIUM" | "HIGH",
      "regulation": "Specific regulation name",
      "description": "What is wrong (1 sentence)",
      "evidence_line": "EXACT single line from content",
      "guidance": "WHY (1-2 sentences, explanation only)",
      "fixed_line": "Compliant replacement line (single line) - Option A",
      "fixed_line_b": "Alternative compliant replacement line (single line) - Option B"
    }
  ]
}

CONTENT:
${inputText}`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    top_p: 1,
    max_tokens: 1600,
    response_format: { type: 'json_object' }
  });

  const responseText = completion.choices[0]?.message?.content || '';
  const parsed = JSON.parse(responseText);
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  const summary = (parsed?.summary || '').toString().trim();

  const normalizedViolations = issues.map((it, idx) => {
    const severity = toTitleSeverity(it?.severity);
    const regulation = (it?.regulation || '').toString().trim() || 'General';
    const description = (it?.description || '').toString().trim() || 'Compliance issue detected';

    const evidenceLine = pickBestLineFromText({
      inputText,
      evidenceCandidate: it?.evidence_line,
      descriptionCandidate: description
    }).replace(/\s+/g, ' ').trim();

    let guidance = (it?.guidance || '').toString().trim();
    if (!isGuidanceValid(guidance)) {
      guidance = deriveGuidanceFallbackShort({ regulation, lang: detectedLang });
    }

    let fixedLine = (it?.fixed_line || '').toString().trim().replace(/\s+/g, ' ');
    let fixedLineB = (it?.fixed_line_b || '').toString().trim().replace(/\s+/g, ' ');
    
    if (!isFixedLineValid(fixedLine, detectedLang)) {
      fixedLine = deterministicFixedLineFallback({ originalLine: evidenceLine, lang: detectedLang, isOptionB: false });
    }
    if (!isFixedLineValid(fixedLineB, detectedLang)) {
      fixedLineB = deterministicFixedLineFallback({ originalLine: evidenceLine, lang: detectedLang, isOptionB: true });
    }

    const recommendedFix = formatRecommendedFixSingle({
      originalLine: evidenceLine,
      fixedLine,
      fixedLineB
    });

    return {
      severity,
      regulation,
      description,
      // Raw fields (kept for internal use / backward compatibility)
      evidence: evidenceLine,
      recommended_fix: recommendedFix,
      // UI contract fields
      problematicContent: evidenceLine, // UI wraps in quotes already
      suggestion: guidance,
      solution: recommendedFix,
      index: idx + 1
    };
  });

  // Deterministic risk score from severities (start 100 subtract)
  const risk_score = (() => {
    if (!Array.isArray(normalizedViolations) || normalizedViolations.length === 0) return 100;
    let score = 100;
    for (const v of normalizedViolations) {
      const s = (v?.severity || '').toString().toLowerCase();
      if (s === 'high' || s === 'critical') score -= 20;
      else if (s === 'medium') score -= 10;
      else if (s === 'low') score -= 5;
      else score -= 10;
    }
    return Math.min(100, Math.max(0, score));
  })();

  const risk_level = risk_score >= 70 ? 'High' : risk_score >= 40 ? 'Medium' : 'Low';
  const status = risk_score >= 70 ? 'NON_COMPLIANT' : 'COMPLIANT';
  const recommended_actions = normalizedViolations.map(v => v.solution).filter(Boolean).slice(0, 5);

  return {
    risk_level,
    risk_score,
    compliance_flags: [],
    summary: summary || 'Audit completed',
    recommended_actions,
    detected_content_types: [sourceType || 'text'],
    violations: normalizedViolations,
    status,
    explanation: summary || 'Audit completed',
    recommended_fix: recommended_actions[0] || ''
  };
}

function isBadEvidence(val) {
  if (!val || typeof val !== 'string') return true;
  const s = val.trim();
  if (s.length === 0) return true;
  return /^(n\/a|na|none|null|not available|unknown)$/i.test(s);
}

function isWeakRecommendation(val) {
  if (!val || typeof val !== 'string') return true;
  const s = val.trim();
  if (s.length < 15) return true;
  return /(review (the )?policy|be careful|follow guidelines|ensure compliance|consult (a )?lawyer|seek legal advice|please review)/i.test(s);
}

function toTitleSeverity(sev) {
  const s = (sev || '').toString().toLowerCase().trim();
  if (s === 'critical') return 'Critical';
  if (s === 'high') return 'High';
  if (s === 'medium') return 'Medium';
  if (s === 'low') return 'Low';
  return 'Medium';
}

function deriveEvidenceFallback({ issue, inputText }) {
  const text = (inputText || '').toString();
  const description = (issue?.description || issue?.violation || '').toString();
  const tokens = description
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

  // Last resort: still non-empty and never N/A
  return `Specific risky content detected in the submitted content related to: "${description.substring(0, 140)}" (exact quote not available)`;
}

function deriveRecommendationFallback({ issue }) {
  const regulation = (issue?.regulation || issue?.law_reference || '').toString().toLowerCase();
  const evidence = (issue?.evidence || '').toString().replace(/^["'\s]+|["'\s]+$/g, '').trim();
  const base = evidence || (issue?.description || issue?.violation || '').toString();
  const softened = base
    .replace(/\b(100%|100 percent|guaranteed?|sure shot|instant|permanent)\b/gi, 'may')
    .replace(/\b(cure|cures|cured|treats|treatment for)\b/gi, 'supports')
    .replace(/\b(no side effects)\b/gi, 'as advised by a qualified professional')
    .replace(/\s+/g, ' ')
    .trim();

  // Always return copy-ready rewrite alternatives (fallback only).
  const optA = softened.length > 0
    ? softened
    : 'Results may vary. Please consult a qualified healthcare professional.';
  const optB = 'Results may vary by individual. This information is not a substitute for professional medical advice.';

  // For DPDP-ish issues, avoid reflecting personal identifiers in replacement text.
  if (regulation.includes('dpdp') || regulation.includes('data protection') || regulation.includes('personal data')) {
    return `RECOMMENDED FIX\nOption A:\n"For support, please contact our official helpline."\n\nOption B:\n"For assistance, please reach out via our official contact channel."`;
  }

  return `RECOMMENDED FIX\nOption A:\n"${optA}"\n\nOption B:\n"${optB}"`;
}

// Normalize text for comparison (remove whitespace, lowercase, remove punctuation)
function normalizeTextForCompare(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .replace(/["'`,.\-;:!?()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate Jaccard similarity between two texts (0-1 scale)
// More strict: uses 3+ character words and considers partial matches
function jaccardSimilarity(a, b) {
  const textA = normalizeTextForCompare(a);
  const textB = normalizeTextForCompare(b);
  const wordsA = new Set(textA.split(' ').filter(w => w.length >= 3));
  const wordsB = new Set(textB.split(' ').filter(w => w.length >= 3));
  
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Check if text contains banned generic phrases
function containsBannedPhrase(text) {
  const normalized = normalizeTextForCompare(text);
  const bannedPatterns = [
    /remove.*misleading.*claim/i,
    /follow.*all.*rule/i,
    /provide.*proper.*information/i,
    /हटाएं.*भ्रामक/i,
    /पालन.*नियम/i,
    /प्रदान.*जानकारी/i
  ];
  return bannedPatterns.some(pattern => pattern.test(normalized));
}

// Generate unique guidance/fix for a violation if duplicates found
// Uses evidence and violation-specific details to ensure uniqueness
function deriveUniqueGuidance({ violation, seenGuidance, seenFixes, index }) {
  const regulation = (violation?.regulation || '').toString().toLowerCase();
  const description = (violation?.description || '').toString();
  const evidence = (violation?.evidence || '').toString().substring(0, 80);
  const evidenceHash = evidence.split('').slice(0, 10).join('').replace(/[^a-z0-9]/gi, '');
  
  // Extract violation nature (license, link, claim, channel, etc.)
  const hasLicense = /license|लाइसेंस/i.test(description + evidence);
  const hasLink = /link|url|http|लिंक/i.test(description + evidence);
  const hasClaim = /claim|guarantee|दावा/i.test(description + evidence);
  const hasChannel = /channel|platform|चैनल/i.test(description + evidence);
  
  // STEP 1 ANALYSIS: Identify CORE RISK, REGULATORY INTENT, SPECIFIC HARM
  // Then build unique guidance that explains WHY (risk/harm focus, no actions)
  
  // Extract core risk from evidence and description
  const hasPersonalData = /personal|data|privacy|consent/i.test(evidence + description);
  const hasHealthClaim = /cure|guarantee|100%|guaranteed|health|treatment/i.test(evidence + description);
  const hasUnlicensed = /unlicensed|without.*license|no.*license/i.test(evidence + description);
  const hasFraudulent = /fraud|scam|unauthorized|unverified/i.test(evidence + description);
  
  // Build guidance that explains WHY (regulatory intent, consumer risk, specific harm)
  // Focus on: risk, harm, regulatory intent - NOT on actions
  let baseGuidance = '';
  
  if (regulation.includes('dpdp') || regulation.includes('data protection')) {
    if (hasLink) {
      baseGuidance = `DPDP Act 2023 requires purpose limitation and secure data handling. The unverified link "${evidence}" creates risk of unauthorized data access and exposes data subjects to privacy breaches, violating the Act's consumer protection intent.`;
    } else if (hasPersonalData) {
      baseGuidance = `DPDP Act 2023 mandates explicit consent and purpose limitation for personal data processing. The evidence "${evidence}" indicates processing without proper consent, creating privacy risk and potential regulatory penalties for data subject harm.`;
    } else {
      baseGuidance = `This data processing activity lacks the consent and purpose limitation required by DPDP Act 2023. The evidence "${evidence}" indicates risk to data subject privacy and undermines regulatory protections for personal information.`;
    }
  } else if (regulation.includes('drugs') || regulation.includes('magic remedies') || regulation.includes('asci')) {
    if (hasLicense) {
      baseGuidance = `Drugs and Cosmetics Act requires all promoted medicines to have valid licenses. The unlicensed reference "${evidence}" exposes consumers to unregulated substances that may lack safety validation, risking patient health and undermining regulatory oversight.`;
    } else if (hasClaim && hasHealthClaim) {
      baseGuidance = `ASCI Healthcare Guidelines prohibit unsubstantiated health claims. The claim "${evidence}" can mislead consumers into delaying proper medical care or making inappropriate self-medication decisions, causing potential harm to patient safety.`;
    } else if (hasLink || hasFraudulent) {
      baseGuidance = `Healthcare advertising standards require verified, legitimate sales channels. The unverified link "${evidence}" directs consumers to potentially fraudulent or unregulated supply channels, creating risk of counterfeit products and consumer safety compromise.`;
    } else if (hasClaim) {
      baseGuidance = `Healthcare communication standards require claims to be substantiated and non-misleading. The claim "${evidence}" can mislead consumers and undermine public trust in medical communications, potentially causing delayed proper medical care.`;
    } else {
      baseGuidance = `Healthcare advertising standards require communications to be truthful and non-misleading. The evidence "${evidence}" violates these standards and can cause consumer harm through misinformation about treatment options or safety.`;
    }
  } else {
    baseGuidance = `Regulatory compliance requirements exist to protect consumers and ensure fair practices. The evidence "${evidence}" indicates non-compliance that may result in consumer harm, unfair trade practices, or regulatory action.`;
  }
  
  // Ensure uniqueness by referencing specific violation details
  return `${baseGuidance} [Issue: ${index}]`;
}

function deriveUniqueFix({ violation, seenGuidance, seenFixes, index }) {
  const regulation = (violation?.regulation || '').toString().toLowerCase();
  const description = (violation?.description || '').toString();
  const evidence = (violation?.evidence || '').toString().substring(0, 80);
  const evidenceHash = evidence.split('').slice(0, 10).join('').replace(/[^a-z0-9]/gi, '');
  
  // Extract violation nature
  const hasLicense = /license|लाइसेंस/i.test(description + evidence);
  const hasLink = /link|url|http|लिंक/i.test(description + evidence);
  const hasClaim = /claim|guarantee|दावा/i.test(description + evidence);
  const hasChannel = /channel|platform|चैनल/i.test(description + evidence);
  
  // STEP 2 OUTPUT: Generate Recommended Fix using DIFFERENT logic path from Guidance
  // Focus on: HOW to fix (actions, implementation) - NOT on WHY or risk
  
  // Extract implementation requirements from violation
  const needsLicenseProof = hasLicense;
  const needsDisclaimer = hasClaim;
  const needsLinkVerification = hasLink;
  const needsConsentFlow = /consent|personal.*data/i.test(evidence + description);
  
  // Build fix that explains HOW (actionable steps, implementation details)
  // Use DIFFERENT logic structure than guidance (actions vs explanations)
  let baseFix = '';
  
  if (regulation.includes('dpdp') || regulation.includes('data protection')) {
    if (needsLinkVerification) {
      baseFix = `Implement link verification: restrict data collection to verified domains, remove unverified link "${evidence}", add privacy notice with purpose statement, create consent capture form, document data purpose in records, enable access controls.`;
    } else if (needsConsentFlow) {
      baseFix = `Implement consent flow: redact personal identifiers from "${evidence}", add privacy notice with retention period, create consent form with explicit opt-in, document consent with timestamp, restrict sharing to stated purposes only, implement access logging.`;
    } else {
      baseFix = `Apply data minimization: remove personal identifiers from "${evidence}", add privacy notice stating purpose and retention, implement consent capture mechanism, document data processing purpose, restrict access to authorized personnel only.`;
    }
  } else if (regulation.includes('drugs') || regulation.includes('magic remedies') || regulation.includes('asci')) {
    if (needsLicenseProof) {
      baseFix = `Verify and display licenses: check medicine license database, include only licensed drugs in advertisement, display license number next to "${evidence}", remove unlicensed drug references, maintain license documentation file, obtain compliance sign-off before publication.`;
    } else if (needsDisclaimer && hasClaim) {
      baseFix = `Modify claim and add disclaimers: remove claim "${evidence}", replace with factual statement backed by clinical evidence, add disclaimer "Individual results may vary", include required ASCI disclaimer text, maintain substantiation file with clinical studies, route through compliance review.`;
    } else if (needsLinkVerification) {
      baseFix = `Implement link verification: restrict sales links to official domains only, remove third-party link "${evidence}", add link verification badge, test link destination functionality, review link terms of service, add disclaimer about third-party sites.`;
    } else {
      baseFix = `Rewrite content for compliance: modify "${evidence}" to be factual and verifiable, remove absolute claims like "guaranteed" or "100%", add appropriate disclaimer about individual results, maintain substantiation documentation, obtain compliance approval before publication.`;
    }
  } else {
    baseFix = `Apply corrective actions: remove claim "${evidence}", replace with factual substantiated wording, add required regulatory disclosures, maintain compliance documentation, obtain internal review approval, test changes before publication.`;
  }
  
  // Ensure uniqueness by referencing specific implementation details
  return `${baseFix} [Actions: ${index}]`;
}

function normalizeViolations({ violations, inputText }) {
  const raw = Array.isArray(violations) ? violations : [];

  // First pass: normalize all violations
  let normalized = raw.map((v) => {
    const regulation = (v?.regulation || v?.law_reference || '').toString().trim() || 'Regulatory reference required';
    const description = (v?.description || v?.violation || '').toString().trim() || 'Compliance issue detected';
    let evidence = (v?.evidence || '').toString().trim();
    let guidance = (v?.guidance || v?.description || '').toString().trim();
    let recommended_fix = (v?.recommended_fix || v?.recommendation || '').toString().trim();

    if (isBadEvidence(evidence)) {
      evidence = deriveEvidenceFallback({ issue: { ...v, regulation, description }, inputText });
    }

    // If guidance is missing, derive from description
    if (!guidance || guidance === description || guidance.trim().length < 20) {
      guidance = `This violation relates to ${regulation}. ${description}`;
    }

    if (isWeakRecommendation(recommended_fix)) {
      recommended_fix = deriveRecommendationFallback({ issue: { ...v, regulation, description } });
    }

    return {
      severity: toTitleSeverity(v?.severity),
      regulation,
      description,
      evidence,
      guidance,
      recommended_fix
    };
  });

  // Second pass: enforce strict uniqueness (regenerate duplicates)
  // NON-NEGOTIABLE: Each violation must have unique Guidance and unique Recommended Fix
  const seenGuidance = new Map();
  const seenFixes = new Map();
  const unique = [];

  for (let i = 0; i < normalized.length; i++) {
    let violation = normalized[i];
    let guidance = violation.guidance;
    let fix = violation.recommended_fix;

    // Check for banned phrases
    const hasBannedInGuidance = containsBannedPhrase(guidance);
    const hasBannedInFix = containsBannedPhrase(fix);

    // ANTI-DUPLICATION ENFORCEMENT: Check ALL violations for duplicates
    // Compare against all previously seen guidance and fixes
    const hasDuplicateGuidance = Array.from(seenGuidance.values()).some(seenG => {
      const similarity = jaccardSimilarity(guidance, seenG);
      // Very strict: 50% similarity threshold - if 50% or more words match, it's duplicate
      return similarity > 0.50;
    });

    // Check for duplicate recommended_fix (very strict: 50% similarity threshold)
    const hasDuplicateFix = Array.from(seenFixes.values()).some(seenF => {
      const similarity = jaccardSimilarity(fix, seenF);
      return similarity > 0.50; // Very strict: 50% similarity threshold
    });

    // Check if guidance === recommended_fix (very strict: 40% similarity threshold)
    // Guidance and Fix must be fundamentally different
    const guidanceEqualsFix = jaccardSimilarity(guidance, fix) > 0.40;

    // If duplicates, banned phrases, or guidance===fix found, regenerate unique versions
    if (hasDuplicateGuidance || hasDuplicateFix || guidanceEqualsFix || hasBannedInGuidance || hasBannedInFix) {
      console.warn(`⚠️  Violation ${i + 1} has duplicate/banned guidance/fix. Regenerating unique versions...`);
      if (hasDuplicateGuidance) console.warn(`   - Duplicate guidance detected`);
      if (hasDuplicateFix) console.warn(`   - Duplicate fix detected`);
      if (guidanceEqualsFix) console.warn(`   - Guidance === Fix detected`);
      if (hasBannedInGuidance) console.warn(`   - Banned phrase in guidance`);
      if (hasBannedInFix) console.warn(`   - Banned phrase in fix`);
      
      const allSeenGuidance = Array.from(seenGuidance.values());
      const allSeenFixes = Array.from(seenFixes.values());
      
      // Generate unique guidance (regenerate if duplicate, banned, or equals fix)
      // Use DIFFERENT logic path from fix to ensure uniqueness
      if (hasDuplicateGuidance || guidanceEqualsFix || hasBannedInGuidance) {
        let attempt = 0;
        let newGuidance = guidance;
        while (attempt < 15) {
          newGuidance = deriveUniqueGuidance({ violation, seenGuidance: allSeenGuidance, seenFixes: allSeenFixes, index: i + 1 });
          // Very strict: 50% similarity = duplicate
          const stillDuplicate = allSeenGuidance.some(seenG => jaccardSimilarity(newGuidance, seenG) > 0.50);
          // Very strict: 40% similarity = too similar to fix
          const stillEqual = jaccardSimilarity(newGuidance, fix) > 0.40;
          const stillBanned = containsBannedPhrase(newGuidance);
          if (!stillDuplicate && !stillEqual && !stillBanned) break;
          attempt++;
        }
        guidance = newGuidance;
        console.log(`✅ Generated unique guidance for violation ${i + 1} (attempt ${attempt + 1})`);
      }

      // Generate unique fix (regenerate if duplicate, banned, or equals guidance)
      // Use INDEPENDENT logic path from guidance to ensure uniqueness
      if (hasDuplicateFix || guidanceEqualsFix || hasBannedInFix) {
        let attempt = 0;
        let newFix = fix;
        while (attempt < 15) {
          newFix = deriveUniqueFix({ violation, seenGuidance: allSeenGuidance, seenFixes: allSeenFixes, index: i + 1 });
          // Very strict: 50% similarity = duplicate
          const stillDuplicate = allSeenFixes.some(seenF => jaccardSimilarity(newFix, seenF) > 0.50);
          // Very strict: 40% similarity = too similar to guidance
          const stillEqual = jaccardSimilarity(guidance, newFix) > 0.40;
          const stillBanned = containsBannedPhrase(newFix);
          if (!stillDuplicate && !stillEqual && !stillBanned) break;
          attempt++;
        }
        fix = newFix;
        console.log(`✅ Generated unique fix for violation ${i + 1} (attempt ${attempt + 1})`);
      }
    }

    // Final check: ensure guidance ≠ fix after regeneration (very strict: 40% threshold)
    const finalSimilarity = jaccardSimilarity(guidance, fix);
    if (finalSimilarity > 0.40) {
      console.warn(`⚠️  Final check: Violation ${i + 1} guidance and fix still too similar (${(finalSimilarity * 100).toFixed(0)}%). Forcing distinct versions...`);
      
      // Force distinctness: Guidance focuses on WHY (risk/harm), Fix focuses on HOW (actions)
      // Ensure guidance explains regulatory intent/consumer risk, not actions
      const guidanceLower = guidance.toLowerCase();
      if (!guidanceLower.includes('risk') && !guidanceLower.includes('harm') && !guidanceLower.includes('danger') && 
          !guidanceLower.includes('mislead') && !guidanceLower.includes('expose') && !guidanceLower.includes('violate')) {
        const coreRisk = violation.evidence ? `The evidence "${violation.evidence.substring(0, 60)}"` : 'This violation';
        guidance = `${coreRisk} creates risk to consumer safety and regulatory compliance. ${guidance}`;
      }
      
      // Ensure fix explains actions, not regulatory philosophy
      const fixLower = fix.toLowerCase();
      if (!fixLower.includes('remove') && !fixLower.includes('add') && !fixLower.includes('replace') && 
          !fixLower.includes('implement') && !fixLower.includes('modify') && !fixLower.includes('apply')) {
        fix = `Take corrective action: ${fix}`;
      }
      
      // Final distinctness check - if still similar, regenerate using different logic paths
      const stillSimilar = jaccardSimilarity(guidance, fix) > 0.40;
      if (stillSimilar) {
        console.warn(`⚠️  Still too similar after forcing distinctness. Regenerating with different logic paths...`);
        const allSeenGuidance = Array.from(seenGuidance.values());
        const allSeenFixes = Array.from(seenFixes.values());
        // Regenerate guidance focusing on WHY (risk/harm)
        guidance = deriveUniqueGuidance({ violation, seenGuidance: allSeenGuidance, seenFixes: allSeenFixes, index: i + 1 });
        // Regenerate fix focusing on HOW (actions) - different logic path
        fix = deriveUniqueFix({ violation, seenGuidance: allSeenGuidance, seenFixes: allSeenFixes, index: i + 1 });
      }
    }

    // Store seen guidance and fixes for next iteration
    seenGuidance.set(i, guidance);
    seenFixes.set(i, fix);

    unique.push({
      ...violation,
      guidance,
      recommended_fix: fix
    });
  }

  console.log(`✅ Uniqueness enforcement complete: ${unique.length} violations, all with unique guidance and fix`);
  return unique;
}

/**
 * UNIFIED AUDIT ENGINE
 *
 * @param {string} inputText - Text content to audit (extracted from any source)
 * @param {string} sourceType - Source type: 'screen' | 'voice' | 'scanner' | 'research' | 'manual'
 * @param {Object} metadata - Optional metadata (sourceId, filename, etc.)
 * @returns {Promise<Object>} Audit result with compliance status
 * @throws {Error} Error object if API call fails
 */
export async function auditText(inputText, sourceType = 'manual', metadata = {}) {
  // Minimal validation
  if (!inputText || typeof inputText !== 'string' || inputText.trim().length === 0) {
    throw new Error('Input text is required and must be a non-empty string');
  }

  // Validate source type
  const validSourceTypes = ['screen', 'voice', 'scanner', 'research', 'manual'];
  if (!validSourceTypes.includes(sourceType)) {
    throw new Error(`Invalid source type: ${sourceType}. Must be one of: ${validSourceTypes.join(', ')}`);
  }

  try {
    console.log(`🧾 Audit rewrite engine (sourceType: ${sourceType}, text length: ${inputText.length})`);
    const result = await runRewriteAudit({ inputText, sourceType, metadata });
    return {
      ...result,
      rules_triggered: Array.isArray(result.compliance_flags) ? result.compliance_flags : [],
      sourceType,
      metadata
    };
    
  } catch (err) {
    // Preserve original error details for logging
    const errorMessage = err.message || 'Unknown error occurred';
    const errorCode = err.code || 'AUDIT_ERROR';
    const errorStatus = err.status || err.statusCode || 500;
    
    // Log full error details for debugging
    console.error("❌ Audit failed:");
    console.error(`   Error Code: ${errorCode}`);
    console.error(`   Error Message: ${errorMessage}`);
    console.error(`   Source Type: ${sourceType}`);
    console.error(`   Error Type: ${err.constructor.name}`);
    
    if (err.response) {
      console.error(`   API Response Status: ${err.response.status}`);
      console.error(`   API Response Data:`, JSON.stringify(err.response.data || {}).substring(0, 500));
    }
    
    if (err.stack) {
      console.error(`   Stack Trace (first 500 chars):`, err.stack.substring(0, 500));
    }
    
    // Create error object with preserved details
    const auditError = new Error(errorMessage);
    auditError.code = errorCode;
    auditError.status = errorStatus;
    auditError.originalError = err.message;
    
    throw auditError;
  }
}
