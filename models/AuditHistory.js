import mongoose from 'mongoose';

const auditHistorySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  emailId: {
    type: String,
    index: true
  },
  auditType: {
    type: String,
    enum: ['email', 'video', 'attachment'],
    default: 'email'
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Compound index for user history queries
auditHistorySchema.index({ userId: 1, timestamp: -1 });

const AuditHistory = mongoose.model('AuditHistory', auditHistorySchema);

export default AuditHistory;





