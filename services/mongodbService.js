/**
 * MongoDB Service Layer
 * Replaces all Firestore operations with MongoDB
 * Using MongoDB-only architecture
 */

import Audit from '../models/Audit.js';
import AuditHistory from '../models/AuditHistory.js';
import User from '../models/User.js';

// =======================================================
// AUDIT OPERATIONS
// =======================================================

/**
 * Save audit to MongoDB
 */
export async function saveAudit(auditDataOrUserId, auditData) {
  // Support both old format (userId, auditData) and new format (auditData with userId)
  let finalAuditData;
  if (auditData && typeof auditDataOrUserId === 'string') {
    // Old format: saveAudit(userId, auditData)
    finalAuditData = { ...auditData, userId: auditDataOrUserId };
  } else {
    // New format: saveAudit({ userId, ... })
    finalAuditData = auditDataOrUserId;
  }
  
  try {
    const audit = new Audit(finalAuditData);
    await audit.save();
    return audit;
  } catch (error) {
    console.error('❌ Save audit error:', error);
    throw error;
  }
}

/**
 * Get audits for user
 */
export async function getUserAudits(userId, options = {}) {
  const { limit = 50, skip = 0, status, sourceType } = options;
  
  const baseFilter = { userId };
  if (sourceType) {
    baseFilter.sourceType = sourceType;
  }

  const query = Audit.find(baseFilter);
  if (status) {
    query.where('status').equals(status);
  }
  
  return await query
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .exec();
}

/**
 * Get audit by ID
 */
export async function getAuditById(userId, auditId) {
  return await Audit.findOne({ _id: auditId, userId });
}

/**
 * Update audit status
 */
export async function updateAuditStatus(userId, auditId, status, auditResult = null) {
  const update = { status, updatedAt: new Date() };
  if (auditResult) {
    update.auditResult = auditResult;
  }
  
  return await Audit.findOneAndUpdate(
    { _id: auditId, userId },
    { $set: update },
    { new: true }
  );
}

// =======================================================
// AUDIT HISTORY OPERATIONS
// =======================================================

/**
 * Save audit history
 */
export async function saveAuditHistory(userId, historyData) {
  const history = new AuditHistory({
    ...historyData,
    userId,
    timestamp: new Date()
  });
  await history.save();
  return history;
}

/**
 * Get audit history for user
 */
export async function getAuditHistory(userId, options = {}) {
  const { limit = 50, skip = 0 } = options;
  
  return await AuditHistory.find({ userId })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .exec();
}

// =======================================================
// USER OPERATIONS
// =======================================================

/**
 * Find user by email
 */
export async function findUserByEmail(email) {
  return await User.findOne({ email: email.toLowerCase() });
}

/**
 * Find users by emails (batch)
 */
export async function findUsersByEmails(emails) {
  const normalizedEmails = emails.map(e => e.toLowerCase());
  const users = await User.find({ email: { $in: normalizedEmails } });
  
  const emailToUserIdMap = new Map();
  users.forEach(user => {
    emailToUserIdMap.set(user.email.toLowerCase(), user._id.toString());
  });
  
  return emailToUserIdMap;
}
