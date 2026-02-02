/**
 * EXAMPLE: How to use generateWithGemini() from a controller
 * 
 * This file demonstrates how to integrate Gemini AI into your controllers.
 * Copy the example code into your controller file.
 */

import { generateWithGemini, GEMINI_MODEL } from './geminiService.js';

/**
 * Example 1: Basic usage in a controller function
 */
export async function exampleBasicUsage(req, res) {
  try {
    const { prompt } = req.body;
    
    // Simple call with default settings
    const response = await generateWithGemini(prompt);
    
    res.json({
      success: true,
      response: response
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: error.message
    });
  }
}

/**
 * Example 2: Usage in secureInboxController.js
 * 
 * Add this to your secureInboxController.js:
 * 
 * import { generateWithGemini, GEMINI_MODEL } from '../services/geminiService.js';
 * 
 * export async function summarizeEmail(req, res) {
 *   try {
 *     const { emailId } = req.params;
 *     const userId = req.user?.uid;
 *     
 *     // Get email from Firestore
 *     const email = await getEmailFromInbox(userId, emailId);
 *     
 *     // Generate summary using Gemini
 *     const prompt = `Summarize this email in 3 bullet points:\n\n${email.subject}\n\n${email.snippet}`;
 *     const summary = await generateWithGemini(prompt);
 *     
 *     res.json({
 *       success: true,
 *       summary: summary,
 *       model: GEMINI_MODEL
 *     });
 *   } catch (error) {
 *     console.error('Error:', error);
 *     res.status(500).json({ error: error.message });
 *   }
 * }
 */
