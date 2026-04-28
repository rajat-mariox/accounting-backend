const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
  },
  { timestamps: { createdAt: 'created', updatedAt: 'updated' } }
);

clientSchema.index({ name: 'text', company: 'text', email: 'text' });

module.exports = mongoose.model('Client', clientSchema);
