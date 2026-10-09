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
    // `amount` is always in the invoice currency; these copy the invoice's currency
    // and rate so payments can be converted to the base currency.
    currency: { type: String, uppercase: true, trim: true, default: 'USD' },
    exchangeRate: { type: Number, default: 1, min: 0 },
    // When the client paid in a different currency: what they handed over and the
    // rate used (units of that currency per 1 unit of the invoice currency).
    received: {
      amount: { type: Number, min: 0 },
      currency: { type: String, uppercase: true, trim: true },
      rate: { type: Number, min: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payment', paymentSchema);
module.exports.PAYMENT_MODES = PAYMENT_MODES;
