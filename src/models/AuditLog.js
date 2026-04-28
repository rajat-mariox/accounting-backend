const mongoose = require('mongoose');

const ACTIONS = ['Create', 'Update', 'Delete', 'Login', 'Logout'];

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, enum: ACTIONS, required: true },
    module: { type: String, required: true },
    details: { type: String },
    tone: { type: String, enum: ['create', 'update', 'delete'], default: 'update' },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

auditLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
module.exports.ACTIONS = ACTIONS;
