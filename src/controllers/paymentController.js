const asyncHandler = require('express-async-handler');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const { recordAudit } = require('../middleware/audit');
const notificationService = require('../services/notificationService');

// GET /api/payments
const listPayments = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === 'Client') {
    // Client portal logins only see payments against their own invoices.
    const ownInvoiceIds = await Invoice.find({ client: req.user.client }).distinct('_id');
    filter.invoice = { $in: ownInvoiceIds };
  }
  const payments = await Payment.find(filter).sort({ date: -1 });
  res.json(payments);
});

// POST /api/payments
const createPayment = asyncHandler(async (req, res) => {
  const { invoice, amount, mode, reference, date } = req.body;
  if (!invoice || amount === undefined || !mode) {
    res.status(400);
    throw new Error('invoice, amount, and mode are required');
  }
  const invoiceDoc = await Invoice.findById(invoice);
  if (!invoiceDoc) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    res.status(400);
    throw new Error('Amount must be greater than 0');
  }
  if (invoiceDoc.status === 'cancelled') {
    res.status(400);
    throw new Error('Cannot record a payment against a cancelled invoice');
  }
  const balance = invoiceDoc.balance;
  if (balance <= 0) {
    res.status(400);
    throw new Error('This invoice is already fully paid');
  }
  if (value > balance + 0.005) {
    res.status(400);
    throw new Error(`Amount exceeds the outstanding balance of ${balance.toFixed(2)}`);
  }
  const payment = await Payment.create({
    invoice: invoiceDoc._id,
    invoiceNumber: invoiceDoc.invoiceNumber,
    amount,
    mode,
    reference,
    date: date || new Date(),
  });

  // Partial payments: track the running total; status becomes partial/paid accordingly.
  const total = await Payment.aggregate([
    { $match: { invoice: invoiceDoc._id } },
    { $group: { _id: null, sum: { $sum: '$amount' } } },
  ]);
  const paidSoFar = total[0]?.sum || 0;
  const wasPaid = invoiceDoc.status === 'paid';
  invoiceDoc.applyPaid(paidSoFar);
  await invoiceDoc.save();
  const invoiceFullyPaid = !wasPaid && invoiceDoc.status === 'paid';

  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Payments',
    details: `Recorded payment of ${amount} for ${invoiceDoc.invoiceNumber}`,
  });

  await notificationService.notifyPaymentRecorded(payment, invoiceDoc);
  if (invoiceFullyPaid) {
    await notificationService.notifyInvoicePaid(invoiceDoc);
  }

  res.status(201).json({ ...payment.toObject(), invoice: invoiceDoc });
});

// DELETE /api/payments/:id
const deletePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) {
    res.status(404);
    throw new Error('Payment not found');
  }
  await payment.deleteOne();
  const invoiceDoc = await Invoice.findById(payment.invoice);
  if (invoiceDoc) {
    const total = await Payment.aggregate([
      { $match: { invoice: invoiceDoc._id } },
      { $group: { _id: null, sum: { $sum: '$amount' } } },
    ]);
    invoiceDoc.applyPaid(total[0]?.sum || 0);
    await invoiceDoc.save();
  }
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Payments',
    details: `Deleted payment ${payment._id}`,
  });
  res.json({ message: 'Payment deleted', invoice: invoiceDoc });
});

module.exports = { listPayments, createPayment, deletePayment };
