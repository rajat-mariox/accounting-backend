const asyncHandler = require('express-async-handler');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const { recordAudit } = require('../middleware/audit');
const notificationService = require('../services/notificationService');

// GET /api/payments
const listPayments = asyncHandler(async (_req, res) => {
  const payments = await Payment.find().sort({ date: -1 });
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
  const payment = await Payment.create({
    invoice: invoiceDoc._id,
    invoiceNumber: invoiceDoc.invoiceNumber,
    amount,
    mode,
    reference,
    date: date || new Date(),
  });

  // mark invoice paid if total payments cover the amount
  const total = await Payment.aggregate([
    { $match: { invoice: invoiceDoc._id } },
    { $group: { _id: null, sum: { $sum: '$amount' } } },
  ]);
  const paidSoFar = total[0]?.sum || 0;
  let invoiceFullyPaid = false;
  if (paidSoFar >= invoiceDoc.amount) {
    invoiceDoc.status = 'paid';
    await invoiceDoc.save();
    invoiceFullyPaid = true;
  }

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

  res.status(201).json(payment);
});

// DELETE /api/payments/:id
const deletePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id);
  if (!payment) {
    res.status(404);
    throw new Error('Payment not found');
  }
  await payment.deleteOne();
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Payments',
    details: `Deleted payment ${payment._id}`,
  });
  res.json({ message: 'Payment deleted' });
});

module.exports = { listPayments, createPayment, deletePayment };
