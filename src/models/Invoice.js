const mongoose = require('mongoose');

const STATUSES = ['paid', 'pending', 'overdue', 'cancelled'];

const lineItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, unique: true, sparse: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    clientName: { type: String, required: true },
    createdDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    items: { type: [lineItemSchema], default: [] },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: STATUSES, default: 'pending' },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

invoiceSchema.virtual('tone').get(function () {
  return this.status;
});

invoiceSchema.set('toJSON', { virtuals: true });
invoiceSchema.set('toObject', { virtuals: true });

invoiceSchema.pre('save', function (next) {
  if (!this.invoiceNumber) {
    this.invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
module.exports.STATUSES = STATUSES;
