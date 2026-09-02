const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
  },
  { timestamps: true }
);

const PAYMENT_STATUSES = ['pending', 'partial', 'paid', 'overdue'];

const installmentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
    reference: { type: String, trim: true },
  },
  { _id: true }
);

const supplyActivitySchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String },
    item: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    pricePerUnit: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    invoiceNumber: { type: String, trim: true },
    // Payment tracking: how much has been paid so far, and when the rest is promised.
    amountPaid: { type: Number, default: 0, min: 0 },
    nextPaymentDate: { type: Date },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
    payments: { type: [installmentSchema], default: [] },
  },
  { timestamps: true }
);

supplyActivitySchema.virtual('balance').get(function () {
  return Math.max(0, Math.round((Number(this.totalAmount || 0) - Number(this.amountPaid || 0)) * 100) / 100);
});

// Calendar-day start (UTC midnight of the local date). Date inputs are stored as
// UTC midnight, so comparing against this treats "due today" as due, not overdue.
function startOfToday(now = new Date()) {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

// Derive paymentStatus from the balance and the promised payment date.
supplyActivitySchema.methods.recomputeStatus = function recomputeStatus(now = new Date()) {
  const balance = this.balance;
  if (balance <= 0) {
    this.paymentStatus = 'paid';
    this.nextPaymentDate = undefined;
  } else if (this.nextPaymentDate && this.nextPaymentDate < startOfToday(now)) {
    this.paymentStatus = 'overdue';
  } else if (Number(this.amountPaid) > 0) {
    this.paymentStatus = 'partial';
  } else {
    this.paymentStatus = 'pending';
  }
  return this;
};

supplyActivitySchema.set('toJSON', { virtuals: true });
supplyActivitySchema.set('toObject', { virtuals: true });

module.exports = {
  Supplier: mongoose.model('Supplier', supplierSchema),
  SupplyActivity: mongoose.model('SupplyActivity', supplyActivitySchema),
  PAYMENT_STATUSES,
  startOfToday,
};
