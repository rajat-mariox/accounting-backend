const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    // Pricing defaults applied to new invoices for this client (both editable per invoice).
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    // Portal login (User with role 'Client') created alongside the client.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: 'created', updatedAt: 'updated' } }
);

clientSchema.index({ name: 'text', company: 'text', email: 'text' });

module.exports = mongoose.model('Client', clientSchema);
