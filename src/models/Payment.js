const mongoose = require('mongoose');

const PAYMENT_MODES = ['Bank Transfer', 'Cash', 'Card', 'Cheque'];

const paymentSchema = new mongoose.Schema(
  {
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    invoiceNumber: { type: String },
    date: { type: Date, default: Date.now },
    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    reference: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
module.exports.PAYMENT_MODES = PAYMENT_MODES;
