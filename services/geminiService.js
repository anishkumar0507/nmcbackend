import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini client (singleton)
let genAI = null;
let isInitialized = false;

/**
 * Initialize Gemini client (called at startup)
 * Returns true if initialized successfully, false otherwise
 */
export function initializeGemini() {
  if (isInitialized) {
    return genAI !== null;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY is missing. Audit functionality will be disabled.");
    genAI = null;
    isInitialized = true;
    return false;
  }

  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    isInitialized = true;
    console.log("✅ Gemini service initialized successfully");
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize Gemini service:", error);
    genAI = null;
    isInitialized = true;
    return false;
  }
}

/**
 * Run Gemini audit - NEVER throws, returns null on error
 * 
 * @param {string} prompt - Text prompt to send to Gemini
 * @returns {Promise<string | null>} Generated text response or null on error
 */
export async function runGeminiAudit(prompt) {
  try {
    // Check if initialized
    if (!isInitialized) {
      initializeGemini();
    }

    // Check if API key is available
    if (!genAI || !process.env.GEMINI_API_KEY) {
      console.error("❌ Gemini audit failed: GEMINI_API_KEY not configured");
      return null;
    }

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      console.error("❌ Gemini audit failed: Invalid prompt");
      return null;
    }

    console.log(`📤 Calling Gemini API`);
    console.log(`   Model: gemini-1.5-flash`);
    console.log(`   Text Length: ${prompt.length} characters`);

    // Get model and generate content
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash"
    });

    const result = await model.generateContent(prompt);

    if (!result || !result.response) {
      console.error("❌ Gemini audit failed: Empty response");
      return null;
    }

    const text = result.response.text();

    if (!text || text.trim().length === 0) {
      console.error("❌ Gemini audit failed: Gemini returned empty text");
      return null;
    }

    console.log(`✅ Gemini API success (${text.length} characters)`);
    return text.trim();
  } catch (err) {
    console.error("❌ Gemini audit failed:", err?.message || err);
    if (err?.stack && process.env.NODE_ENV === 'development') {
      console.error("   Stack:", err.stack.substring(0, 500));
    }
    return null; // IMPORTANT: never throw
  }
}
