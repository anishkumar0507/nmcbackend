import fs from 'fs-extra';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract metadata from video file
 * For now, we extract basic metadata (size, filename, mimeType)
 * Duration extraction would require ffmpeg (can be added later)
 * 
 * @param {Buffer|string} videoSource - Video buffer or file path
 * @param {string} filename - Video filename
 * @param {string} mimeType - Video MIME type
 * @returns {Promise<Object>} Video metadata
 */
export async function extractVideoMetadata(videoSource, filename, mimeType) {
  try {
    let size = 0;
    let buffer = null;

    // Handle buffer or file path
    if (Buffer.isBuffer(videoSource)) {
      buffer = videoSource;
      size = buffer.length;
    } else if (typeof videoSource === 'string') {
      // File path
      const fullPath = videoSource.startsWith('/') || videoSource.includes(':') 
        ? videoSource 
        : join(__dirname, '../../', videoSource);
      
      if (await fs.pathExists(fullPath)) {
        const stats = await fs.stat(fullPath);
        size = stats.size;
        buffer = await fs.readFile(fullPath);
      } else {
        throw new Error(`Video file not found: ${videoSource}`);
      }
    } else {
      throw new Error('Invalid video source: must be Buffer or file path');
    }

    // Extract basic metadata
    const metadata = {
      filename: filename || 'unknown',
      mimeType: mimeType || 'video/mp4',
      size: size,
      sizeMB: (size / 1024 / 1024).toFixed(2),
      // Duration extraction would require ffmpeg - skipping for now
      duration: null,
      // Basic format detection from extension
      format: filename.split('.').pop()?.toLowerCase() || 'unknown'
    };

    console.log(`📹 Extracted video metadata: ${metadata.filename} (${metadata.sizeMB} MB, ${metadata.format})`);

    return metadata;
  } catch (error) {
    console.error(`❌ Error extracting video metadata:`, error.message);
    throw error;
  }
}

/**
 * Get video file from storage (local filesystem or Gmail attachment)
 * 
 * @param {Object} video - Video object with filePath, buffer, or attachmentId
 * @param {Function} downloadFn - Optional function to download from Gmail (downloadAttachmentForUser)
 * @param {string} userId - User ID for Gmail download
 * @param {string} emailId - Email ID for Gmail download
 * @returns {Promise<Buffer>} Video buffer
 */
export async function getVideoFile(video, downloadFn = null, userId = null, emailId = null) {
  try {
    // If video has buffer directly, use it
    if (video.buffer && Buffer.isBuffer(video.buffer)) {
      return video.buffer;
    }
    
    // If video has attachmentId and download function provided, download from Gmail
    if (video.attachmentId && downloadFn && userId && emailId) {
      console.log(`📥 Downloading video from Gmail attachment: ${video.attachmentId}`);
      return await downloadFn(userId, emailId, video.attachmentId);
    }
    
    // Try local file path
    if (video.filePath) {
      const fullPath = video.filePath.startsWith('/') || video.filePath.includes(':')
        ? video.filePath
        : join(__dirname, '../../', video.filePath);
      
      if (await fs.pathExists(fullPath)) {
        return await fs.readFile(fullPath);
      } else {
        throw new Error(`Video file not found: ${video.filePath}`);
      }
    }

    throw new Error('No valid video source found. Video must have buffer, attachmentId (with downloadFn), or filePath');
  } catch (error) {
    console.error(`❌ Error getting video file:`, error.message);
    throw error;
  }
}








