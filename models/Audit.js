import mongoose from 'mongoose';

const auditSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  // Source identification
  sourceType: {
    type: String,
    enum: ['inbox', 'screen', 'voice', 'scanner', 'research', 'manual', 'text', 'url', 'image', 'video', 'audio', 'email'],
    required: true,
    index: true
  },
  sourceId: {
    type: String,
    index: true
  },
  // Source metadata
  sourceMetadata: {
    type: mongoose.Schema.Types.Mixed
  },
  // Extracted text (what was audited)
  extractedText: {
    type: String,
    required: true
  },
  // Audit result
  auditResult: {
    status: String,
    risk_score: Number,
    violations: [mongoose.Schema.Types.Mixed],
    rules_triggered: [String],
    explanation: String,
    recommended_fix: String
  },
  // Legacy fields (for backward compatibility)
  emailId: {
    type: String,
    index: true
  },
  caption: String,
  videoUrl: String,
  videoPath: String,
  source: {
    type: String,
    default: 'email'
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'completed',
    index: true
  },
  openaiResponse: {
    type: mongoose.Schema.Types.Mixed
  },
  // Legacy field (kept for backward compatibility)
  geminiResponse: {
    type: mongoose.Schema.Types.Mixed
  },
  // Hash-based caching for deterministic results
  inputHash: {
    type: String,
    index: true // Index for fast cache lookups
  },
  // Outbound reply tracking (for inbox flow)
  reply: {
    sent: { type: Boolean, default: false, index: true },
    sentAt: { type: Date, default: null },
    to: { type: String, default: null },
    replyMessageId: { type: String, default: null },
    error: { type: String, default: null }
  }
}, {
  timestamps: true // Automatically manages createdAt and updatedAt
});

// Compound index for user audit queries
auditSchema.index({ userId: 1, createdAt: -1 });
auditSchema.index({ userId: 1, status: 1 });
// Index for hash-based cache lookups (critical for stability)
auditSchema.index({ inputHash: 1, status: 1 });

const Audit = mongoose.model('Audit', auditSchema);

export default Audit;


