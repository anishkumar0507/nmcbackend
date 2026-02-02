/**
 * Local File Storage Service
 * Replaces Firebase Storage with local disk storage
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Storage base directory
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const EMAIL_ATTACHMENTS_DIR = path.join(UPLOADS_DIR, 'emailAttachments');
const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');

// Ensure directories exist
async function ensureDirectories() {
  await fs.ensureDir(UPLOADS_DIR);
  await fs.ensureDir(EMAIL_ATTACHMENTS_DIR);
  await fs.ensureDir(VIDEOS_DIR);
}

// Initialize on module load
ensureDirectories().catch(err => {
  console.error('❌ Failed to create upload directories:', err);
});

/**
 * Upload email attachment to local storage
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} emailId - Email ID
 * @param {string} userId - User ID
 * @returns {Promise<{filePath: string, publicUrl: string}>}
 */
export async function uploadEmailAttachment(buffer, filename, emailId, userId) {
  try {
    await ensureDirectories();
    
    // Create user-specific directory
    const userDir = path.join(EMAIL_ATTACHMENTS_DIR, userId);
    await fs.ensureDir(userDir);
    
    // Create email-specific directory
    const emailDir = path.join(userDir, emailId);
    await fs.ensureDir(emailDir);
    
    // Sanitize filename
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = path.join(emailDir, sanitizedFilename);
    
    // Write file
    await fs.writeFile(filePath, buffer);
    
    // Generate public URL (relative path for serving)
    const publicUrl = `/uploads/emailAttachments/${userId}/${emailId}/${sanitizedFilename}`;
    
    console.log(`   ✅ Saved attachment locally: ${filePath}`);
    
    return {
      filePath,
      publicUrl,
      size: buffer.length
    };
  } catch (error) {
    console.error(`❌ Local storage upload error:`, error.message);
    throw new Error(`Failed to upload attachment: ${error.message}`);
  }
}

/**
 * Upload video to local storage
 * @param {Buffer} buffer - Video buffer
 * @param {string} filename - Original filename
 * @returns {Promise<{filePath: string, publicUrl: string}>}
 */
export async function uploadVideo(buffer, filename) {
  try {
    await ensureDirectories();
    
    // Create timestamped filename
    const timestamp = Date.now();
    const sanitizedFilename = `${timestamp}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = path.join(VIDEOS_DIR, sanitizedFilename);
    
    // Write file
    await fs.writeFile(filePath, buffer);
    
    // Generate public URL
    const publicUrl = `/uploads/videos/${sanitizedFilename}`;
    
    console.log(`   ✅ Saved video locally: ${filePath}`);
    
    return {
      filePath,
      publicUrl,
      size: buffer.length
    };
  } catch (error) {
    console.error(`❌ Local video storage error:`, error.message);
    throw new Error(`Failed to upload video: ${error.message}`);
  }
}

/**
 * Delete file from local storage
 */
export async function deleteFile(filePath) {
  try {
    await fs.remove(filePath);
    console.log(`   ✅ Deleted file: ${filePath}`);
  } catch (error) {
    console.error(`❌ Failed to delete file:`, error.message);
    throw error;
  }
}

/**
 * Get file path for serving
 */
export function getFilePath(relativePath) {
  return path.join(UPLOADS_DIR, relativePath);
}

/**
 * Check if file exists
 */
export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}





