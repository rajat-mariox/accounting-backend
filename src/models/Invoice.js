const mongoose = require('mongoose');

const STATUSES = ['paid', 'partial', 'pending', 'overdue', 'cancelled'];

const lineItemSchema = new mongoose.Schema(
  {
    // Inventory item the line was sold from (stock is deducted on create).
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },
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
    // Pricing: subtotal -> discount -> tax on the discounted amount -> amount (grand total).
    subtotal: { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },
    taxAmount: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    // Sum of recorded payments; status becomes 'partial' until it covers `amount`.
    amountPaid: { type: Number, default: 0, min: 0 },
    // Date the client promised to pay the (remaining) balance.
    nextPaymentDate: { type: Date },
    status: { type: String, enum: STATUSES, default: 'pending' },
    notes: { type: String, trim: true },
    // True while the invoice's quantities are deducted from inventory.
    stockDeducted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

invoiceSchema.virtual('tone').get(function () {
  return this.status;
});

invoiceSchema.virtual('balance').get(function () {
  return Math.max(0, Math.round((Number(this.amount || 0) - Number(this.amountPaid || 0)) * 100) / 100);
});

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Pure pricing calculation shared by create/update.
invoiceSchema.statics.computeTotals = function computeTotals(items = [], discountPercent = 0, taxRate = 0) {
  const subtotal = round2(items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0));
  const discountAmount = round2(subtotal * (Number(discountPercent) || 0) / 100);
  const taxable = round2(subtotal - discountAmount);
  const taxAmount = round2(taxable * (Number(taxRate) || 0) / 100);
  const amount = round2(taxable + taxAmount);
  return { subtotal, discountPercent: Number(discountPercent) || 0, discountAmount, taxRate: Number(taxRate) || 0, taxAmount, amount };
};

// Sync amountPaid + status from the total paid so far. Cancelled invoices are left alone.
invoiceSchema.methods.applyPaid = function applyPaid(paidTotal) {
  this.amountPaid = round2(paidTotal);
  if (this.status === 'cancelled') return this;
  if (this.amount > 0 && this.amountPaid >= this.amount - 0.005) {
    this.status = 'paid';
    // Nothing left to collect, so the promised next payment date no longer applies.
    this.nextPaymentDate = undefined;
  } else if (this.amountPaid > 0) {
    this.status = 'partial';
  } else if (this.status === 'paid' || this.status === 'partial') {
    this.status = 'pending';
  }
  return this;
};

invoiceSchema.set('toJSON', { virtuals: true });
invoiceSchema.set('toObject', { virtuals: true });

// Invoice number format: JGC-MM-###
//   MM  = month of the invoice's created date
//   ### = ONE continuous sequence across all months/years (never resets):
//         JGC-08-001, JGC-08-002, then September -> JGC-09-003, ...
// The sequence comes from a single atomic counter, so concurrent creates never clash
// and numbers can never repeat. If the agreed format changes, edit `formatInvoiceNumber` only.
const INVOICE_PREFIX = 'JGC';
const INVOICE_COUNTER_KEY = 'invoice';

function formatInvoiceNumber(date, seq) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${INVOICE_PREFIX}-${mm}-${String(seq).padStart(3, '0')}`;
}

invoiceSchema.statics.nextInvoiceNumber = async function nextInvoiceNumber(date = new Date()) {
  const Counter = require('./Counter');
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const seq = await Counter.next(INVOICE_COUNTER_KEY);
  return formatInvoiceNumber(d, seq);
};

invoiceSchema.pre('save', async function (next) {
  try {
    if (!this.invoiceNumber) {
      this.invoiceNumber = await this.constructor.nextInvoiceNumber(this.createdDate || new Date());
    }
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Invoice', invoiceSchema);
module.exports.STATUSES = STATUSES;
