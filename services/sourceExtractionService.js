/**
 * CENTRALIZED SOURCE EXTRACTION SERVICE
 * Extracts text from various source types before sending to audit engine
 * 
 * Rules:
 * - AI ONLY receives text
 * - No direct image/audio/video sent to AI
 * - All sources must extract text first
 */

import fs from 'fs-extra';
import { processAttachment } from './attachmentService.js';

// Tesseract OCR - optional dependency (lazy loaded)
let Tesseract = null;
let tesseractLoaded = false;

/**
 * Lazy load Tesseract OCR
 */
async function loadTesseract() {
  if (tesseractLoaded) {
    return Tesseract;
  }
  
  try {
    const tesseractModule = await import('tesseract.js');
    Tesseract = tesseractModule.default;
    tesseractLoaded = true;
    return Tesseract;
  } catch (error) {
    console.warn('⚠️  tesseract.js not installed. OCR functionality will be disabled.');
    console.warn('   Install with: npm install tesseract.js');
    tesseractLoaded = true; // Mark as attempted to avoid repeated warnings
    return null;
  }
}

/**
 * Extract text from screen capture (screenshot/image)
 * Uses OCR (Tesseract) to extract text from images
 * 
 * @param {Buffer|string} imageData - Image buffer or file path
 * @param {Object} options - Extraction options
 * @returns {Promise<{text: string, confidence: number}>}
 */
export async function extractFromScreen(imageData, options = {}) {
  try {
    console.log('📸 Extracting text from screen capture via OCR...');
    
    // Lazy load Tesseract
    const tesseract = await loadTesseract();
    if (!tesseract) {
      throw new Error('tesseract.js is not installed. Please install it with: npm install tesseract.js');
    }
    
    let imageBuffer;
    if (Buffer.isBuffer(imageData)) {
      imageBuffer = imageData;
    } else if (typeof imageData === 'string') {
      // Assume it's a file path
      imageBuffer = await fs.readFile(imageData);
    } else {
      throw new Error('Invalid image data: must be Buffer or file path');
    }

    // Use Tesseract OCR
    const { data: { text, confidence } } = await tesseract.recognize(imageBuffer, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`   OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    console.log(`✅ OCR completed: ${text.length} characters extracted (confidence: ${confidence}%)`);
    
    return {
      text: text.trim(),
      confidence: confidence,
      method: 'ocr'
    };
  } catch (error) {
    console.error('❌ Screen extraction error:', error.message);
    throw new Error(`Failed to extract text from screen: ${error.message}`);
  }
}

/**
 * Extract text from video file
 * Uses video-to-audio then speech-to-text pipeline
 * 
 * @param {Buffer|string} videoData - Video buffer or file path
 * @param {Object} options - Extraction options
 * @returns {Promise<{text: string, duration: number}>}
 */
export async function extractFromVideo(videoData, options = {}) {
  try {
    console.log('🎥 Extracting text from video...');
    
    // TODO: Implement video-to-audio conversion
    // TODO: Implement speech-to-text (using Google Speech-to-Text API or similar)
    
    // For now, return placeholder
    // In production, this would:
    // 1. Extract audio track from video
    // 2. Send audio to speech-to-text service
    // 3. Return transcript
    
    throw new Error('Video extraction not yet implemented. Please use audio files directly.');
  } catch (error) {
    console.error('❌ Video extraction error:', error.message);
    throw error;
  }
}

/**
 * Extract text from audio file (microphone recording)
 * Uses speech-to-text to transcribe audio
 * 
 * @param {Buffer|string} audioData - Audio buffer or file path
 * @param {Object} options - Extraction options
 * @returns {Promise<{text: string, duration: number}>}
 */
export async function extractFromVoice(audioData, options = {}) {
  try {
    console.log('🎤 Extracting text from audio via speech-to-text...');
    
    // TODO: Implement speech-to-text
    // Options:
    // 1. Google Cloud Speech-to-Text API
    // 2. OpenAI Whisper API
    // 3. Azure Speech Services
    
    // For now, return placeholder
    throw new Error('Voice extraction not yet implemented. Please provide text directly.');
  } catch (error) {
    console.error('❌ Voice extraction error:', error.message);
    throw error;
  }
}

/**
 * Extract text from uploaded file
 * Supports PDF, DOCX, images, etc.
 * 
 * @param {Buffer|string} fileData - File buffer or file path
 * @param {string} filename - Original filename
 * @param {string} mimeType - File MIME type
 * @returns {Promise<{text: string, fileType: string}>}
 */
export async function extractFromScanner(fileData, filename, mimeType) {
  try {
    console.log(`📄 Extracting text from file: ${filename} (${mimeType})`);
    
    let buffer;
    if (Buffer.isBuffer(fileData)) {
      buffer = fileData;
    } else if (typeof fileData === 'string') {
      buffer = await fs.readFile(fileData);
    } else {
      throw new Error('Invalid file data: must be Buffer or file path');
    }

    // Use existing attachment processing service
    const result = await processAttachment(buffer, filename, mimeType);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to extract text from file');
    }

    console.log(`✅ File extraction completed: ${result.text.length} characters`);
    
    return {
      text: result.text,
      fileType: result.type,
      method: 'file-extraction'
    };
  } catch (error) {
    console.error('❌ Scanner extraction error:', error.message);
    throw new Error(`Failed to extract text from file: ${error.message}`);
  }
}

/**
 * Extract text from web URL (scraping)
 * Fetches web content and extracts text
 * 
 * @param {string} url - Web URL to scrape
 * @param {Object} options - Scraping options
 * @returns {Promise<{text: string, url: string, title: string}>}
 */
export async function extractFromResearch(url, options = {}) {
  try {
    console.log(`🌐 Extracting text from URL: ${url}`);
    
    // TODO: Implement web scraping
    // Options:
    // 1. Cheerio for HTML parsing
    // 2. Puppeteer for JavaScript-rendered pages
    // 3. Readability API for clean text extraction
    
    // For now, return placeholder
    throw new Error('Research extraction not yet implemented. Please provide text directly.');
  } catch (error) {
    console.error('❌ Research extraction error:', error.message);
    throw error;
  }
}

