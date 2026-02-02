import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import fs from 'fs-extra';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { transcribeWithWhisper } from './openaiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMP_DIR = join(__dirname, '../temp');
const MAX_SIZE = 100 * 1024 * 1024; // 100MB

// Tesseract OCR - optional dependency (lazy loaded)
let Tesseract = null;
let tesseractLoaded = false;

async function loadTesseract() {
  if (tesseractLoaded) return Tesseract;

  try {
    const tesseractModule = await import('tesseract.js');
    Tesseract = tesseractModule.default;
  } catch (error) {
    // Keep OCR optional and non-fatal. Callers should handle unsupported types.
    Tesseract = null;
  } finally {
    tesseractLoaded = true;
  }

  return Tesseract;
}

/**
 * Process attachment and extract text content
 */
export async function processAttachment(buffer, filename, mimeType) {
  try {
    // Validate size
    if (buffer.length > MAX_SIZE) {
      throw new Error(`Attachment ${filename} exceeds 100MB limit`);
    }

    const ext = filename.split('.').pop()?.toLowerCase();
    let extractedText = '';

    // Image processing (OCR)
    if (mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'gif'].includes(ext || '')) {
      extractedText = await extractFromImage(buffer, filename);
    }
    // PDF processing
    else if (mimeType === 'application/pdf' || ext === 'pdf') {
      extractedText = await extractFromPDF(buffer);
    }
    // DOCX processing
    else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
      extractedText = await extractFromDOCX(buffer);
    }
    // Video processing (mock transcript)
    else if (mimeType.startsWith('video/') || ['mp4', 'mov', 'avi'].includes(ext || '')) {
      extractedText = await extractFromVideo(buffer, filename);
    }
    // Audio processing (mock transcript)
    else if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'm4a'].includes(ext || '')) {
      extractedText = await extractFromAudio(buffer, filename);
    }
    else {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    return {
      success: true,
      text: extractedText,
      type: getContentType(mimeType, ext)
    };
  } catch (error) {
    console.error(`Error processing attachment ${filename}:`, error);
    return {
      success: false,
      text: '',
      error: error.message,
      type: 'unknown'
    };
  }
}

/**
 * Extract text from image via OCR (Tesseract)
 */
async function extractFromImage(buffer, filename) {
  const tesseract = await loadTesseract();
  if (!tesseract) {
    throw new Error('OCR unavailable: install tesseract.js to extract text from image attachments');
  }

  try {
    console.log(`🖼️  OCR image attachment: ${filename}`);
    const { data: { text } } = await tesseract.recognize(buffer, 'eng', {
      logger: () => {} // quiet by default
    });
    return (text || '').trim();
  } catch (error) {
    throw new Error(`Image OCR failed: ${error.message}`);
  }
}

/**
 * Extract text from PDF
 */
async function extractFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error.message}`);
  }
}

/**
 * Extract text from DOCX
 */
async function extractFromDOCX(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (error) {
    throw new Error(`DOCX parsing failed: ${error.message}`);
  }
}

/**
 * Extract audio/video transcription using OpenAI Whisper API
 */
async function extractFromVideo(buffer, filename) {
  try {
    console.log(`🎥 Transcribing video: ${filename}`);
    const transcription = await transcribeWithWhisper(buffer, filename);
    return `[VIDEO TRANSCRIPTION]\nFile: ${filename}\n\n${transcription}`;
  } catch (error) {
    console.error(`Error transcribing video ${filename}:`, error);
    return `[VIDEO TRANSCRIPTION ERROR]\nFile: ${filename}\nError: ${error.message}\n\nNote: Video file exists but transcription failed. Please review manually.`;
  }
}

/**
 * Extract audio transcription using OpenAI Whisper API
 */
async function extractFromAudio(buffer, filename) {
  try {
    console.log(`🎤 Transcribing audio: ${filename}`);
    const transcription = await transcribeWithWhisper(buffer, filename);
    return `[AUDIO TRANSCRIPTION]\nFile: ${filename}\n\n${transcription}`;
  } catch (error) {
    console.error(`Error transcribing audio ${filename}:`, error);
    return `[AUDIO TRANSCRIPTION ERROR]\nFile: ${filename}\nError: ${error.message}\n\nNote: Audio file exists but transcription failed. Please review manually.`;
  }
}

/**
 * Determine content type for audit
 */
function getContentType(mimeType, ext) {
  if (mimeType?.startsWith('video/') || ['mp4', 'mov', 'avi'].includes(ext || '')) {
    return 'video';
  }
  if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'm4a'].includes(ext || '')) {
    return 'audio';
  }
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return 'document';
  }
  if (mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'gif'].includes(ext || '')) {
    return 'image';
  }
  if (mimeType?.includes('wordprocessingml') || ext === 'docx') {
    return 'document';
  }
  return 'text';
}

/**
 * Clean up temp files
 */
export async function cleanupTempFiles() {
  try {
    await fs.emptyDir(TEMP_DIR);
  } catch (error) {
    console.error('Error cleaning temp files:', error);
  }
}

