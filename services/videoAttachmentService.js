import { downloadAttachmentForUser } from './gmailServicePerUser.js';
import { storeVideoAttachment } from './videoStorageService.js';

/**
 * Process video attachments from email
 * Downloads videos from Gmail and stores them
 * 
 * @param {string} messageId - Gmail message ID
 * @param {Array} attachments - Array of attachment objects with attachmentId, filename, mimeType, size
 * @param {string} emailId - Email ID (for storage path)
 * @param {string} userId - User ID (for storage path)
 * @returns {Promise<Array>} Array of video metadata objects
 */
export async function processVideoAttachments(messageId, attachments, emailId, userId) {
  const videos = [];

  if (!attachments || attachments.length === 0) {
    return videos;
  }

  // Filter only video attachments
  const videoAttachments = attachments.filter(att => 
    att.mimeType && att.mimeType.startsWith('video/')
  );

  if (videoAttachments.length === 0) {
    return videos;
  }

  console.log(`🎥 Found ${videoAttachments.length} video attachment(s) in email ${emailId}`);

  // Process each video attachment
  for (const attachment of videoAttachments) {
    try {
      const { attachmentId, filename, mimeType, size } = attachment;

      if (!attachmentId) {
        console.warn(`⚠️  Skipping video ${filename}: missing attachmentId`);
        continue;
      }

      const sizeMB = size ? (size / 1024 / 1024).toFixed(2) : 'unknown';
      console.log(`⬇️ Downloading video: ${filename} (${sizeMB} MB)`);

      // Download video from Gmail using user-specific function
      const videoBuffer = await downloadAttachmentForUser(userId, messageId, attachmentId);

      if (!videoBuffer || videoBuffer.length === 0) {
        console.warn(`⚠️  Skipping video ${filename}: empty buffer`);
        continue;
      }

      // Store video (Firebase Storage or local)
      const storageResult = await storeVideoAttachment(
        videoBuffer,
        filename,
        mimeType,
        emailId,
        userId
      );

      // Add video metadata to array
      videos.push({
        emailId,
        filename: storageResult.filename,
        mimeType: storageResult.mimeType,
        size: storageResult.size,
        storageURL: storageResult.storageURL || null,
        filePath: storageResult.filePath || null,
        storageType: storageResult.storageType,
        createdAt: storageResult.createdAt
      });

      console.log(`✅ Video stored successfully: ${filename}`);
    } catch (error) {
      console.error(`❌ Error processing video ${attachment.filename}:`, error.message);
      // Continue with other videos - don't fail entire email processing
    }
  }

  return videos;
}

