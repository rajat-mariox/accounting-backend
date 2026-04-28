const mongoose = require('mongoose');

const TONES = ['info', 'success', 'warning', 'danger'];
const CATEGORIES = ['LowStock', 'Overdue', 'Invoice', 'Payment', 'System'];

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    tone: { type: String, enum: TONES, default: 'info' },
    category: { type: String, enum: CATEGORIES, default: 'System' },
    // Stable key for idempotent upserts (e.g. "low-stock:<itemId>"). Optional.
    key: { type: String, unique: true, sparse: true },
    link: { type: String },
    read: { type: Boolean, default: false },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.TONES = TONES;
module.exports.CATEGORIES = CATEGORIES;
