import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Local storage directory (MongoDB-only architecture, Firebase removed)
const LOCAL_VIDEO_DIR = join(__dirname, '../../uploads/videos');

// Ensure local directory exists
fs.ensureDirSync(LOCAL_VIDEO_DIR);

/**
 * Store video attachment
 * Uses local filesystem storage (Firebase removed)
 * 
 * @param {Buffer} videoBuffer - Video file buffer
 * @param {string} filename - Original filename
 * @param {string} mimeType - MIME type (e.g., video/mp4)
 * @param {string} emailId - Email ID this video belongs to
 * @param {string} userId - User ID (for storage path organization)
 * @returns {Promise<Object>} Storage metadata with filePath
 */
export async function storeVideoAttachment(videoBuffer, filename, mimeType, emailId, userId) {
  try {
    if (!videoBuffer || videoBuffer.length === 0) {
      throw new Error('Video buffer is empty');
    }

    if (!filename) {
      throw new Error('Filename is required');
    }

    if (!mimeType || !mimeType.startsWith('video/')) {
      throw new Error('Invalid video MIME type');
    }

    const fileSize = videoBuffer.length;
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Generate unique filename using timestamp and random hash
    const uniqueId = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const uniqueFilename = `${uniqueId}_${sanitizedFilename}`;

    console.log(`🎥 Video attachment detected: ${filename}`);
    console.log(`   Size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   MIME Type: ${mimeType}`);

    // Save to local filesystem
    const filePath = await saveToLocalStorage(
      videoBuffer,
      uniqueFilename,
      emailId,
      userId
    );

    console.log(`✅ Video stored successfully in local storage`);
    console.log(`   Path: ${filePath}`);

    return {
      success: true,
      filePath,
      filename: sanitizedFilename,
      mimeType,
      size: fileSize,
      storageType: 'local',
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`❌ Error storing video attachment:`, error.message);
    throw new Error(`Failed to store video: ${error.message}`);
  }
}

/**
 * Save video to local filesystem
 */
async function saveToLocalStorage(videoBuffer, filename, emailId, userId) {
  try {
    // Create user-specific directory
    const userDir = join(LOCAL_VIDEO_DIR, userId || 'system');
    const emailDir = join(userDir, emailId || 'unknown');
    
    await fs.ensureDir(emailDir);

    // Save file
    const filePath = join(emailDir, filename);
    await fs.writeFile(filePath, videoBuffer);

    // Return relative path from project root
    return `uploads/videos/${userId || 'system'}/${emailId || 'unknown'}/${filename}`;
  } catch (error) {
    console.error(`❌ Local storage save error:`, error.message);
    throw error;
  }
}

/**
 * Delete video attachment (cleanup)
 * Firebase removed - only local storage cleanup
 */
export async function deleteVideoAttachment(filePath, userId) {
  try {
    if (filePath) {
      // Delete from local storage
      const fullPath = join(__dirname, '../../', filePath);
      if (await fs.pathExists(fullPath)) {
        await fs.remove(fullPath);
        console.log(`✅ Deleted video from local storage: ${filePath}`);
      }
    }
  } catch (error) {
    console.error(`❌ Error deleting video:`, error.message);
    // Don't throw - cleanup failures shouldn't break the flow
  }
}
