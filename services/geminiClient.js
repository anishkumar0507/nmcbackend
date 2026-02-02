import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini client (singleton pattern)
let genAI = null;

function getGenAI() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

// Model: gemini-1.5-flash (FREE tier)
const GEMINI_MODEL = "gemini-1.5-flash";

/**
 * Run Gemini API using official @google/generative-ai SDK
 * 
 * Uses model: gemini-1.5-flash (FREE tier)
 * Gemini ONLY receives TEXT - no images, audio, or video blobs
 * 
 * @param {string} prompt - Text prompt to send to Gemini
 * @returns {Promise<string>} Generated text response
 */
export async function runGemini(prompt) {
  // Validate API key
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error('GEMINI_API_KEY environment variable is not set');
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
    console.log(`📤 Calling Gemini API`);
    console.log(`   SDK: @google/generative-ai`);
    console.log(`   Model: ${GEMINI_MODEL}`);
    console.log(`   Text Length: ${prompt.length} characters`);
    
    // Get Gemini client and model
    const client = getGenAI();
    const model = client.getGenerativeModel({ model: GEMINI_MODEL });

    // Generate content (text only)
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    if (!text || text.trim().length === 0) {
      const error = new Error('Empty response from Gemini API');
      error.code = 'EMPTY_RESPONSE';
      throw error;
    }

    console.log(`✅ Gemini API success (${text.length} characters)`);
    return text.trim();
  } catch (error) {
    // Determine error code
    if (!error.code) {
      if (error.message && error.message.includes('API key')) {
        error.code = 'AUTHENTICATION_ERROR';
      } else if (error.message && (error.message.includes('model') || 
                 error.message.includes('not found') ||
                 error.message.includes('NOT_FOUND'))) {
        error.code = 'MODEL_ERROR';
      } else if (error.message && (error.message.includes('quota') || error.message.includes('rate limit'))) {
        error.code = 'RATE_LIMIT_ERROR';
      } else {
        error.code = 'GEMINI_API_ERROR';
      }
    }

    // Enhanced error logging
    console.error(`❌ Gemini API error:`);
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
