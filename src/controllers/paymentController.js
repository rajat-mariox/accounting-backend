const asyncHandler = require('express-async-handler');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const { recordAudit } = require('../middleware/audit');
const notificationService = require('../services/notificationService');
const { resolveCurrency } = require('../services/currencyService');

// GET /api/payments
const listPayments = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === 'Client') {
    // Client portal logins only see payments against their own invoices.
    const ownInvoiceIds = await Invoice.find({ client: req.user.client }).distinct('_id');
    filter.invoice = { $in: ownInvoiceIds };
  }
  // Newest first; payments on the same day keep the order they were recorded in.
  const payments = await Payment.find(filter).sort({ date: -1, createdAt: -1, _id: -1 });
  res.json(payments);
});

// POST /api/payments
const createPayment = asyncHandler(async (req, res) => {
  const { invoice, mode, reference, date } = req.body;
  let { amount } = req.body;
  // Paid in another currency: { amount, currency, rate } where rate is units of that
  // currency per 1 unit of the invoice currency. The invoice is credited amount / rate.
  let received;
  if (req.body.received && req.body.received.amount !== undefined && req.body.received.amount !== '') {
    const recvAmount = Number(req.body.received.amount);
    const recvRate = Number(req.body.received.rate);
    if (!Number.isFinite(recvAmount) || recvAmount <= 0) {
      res.status(400);
      throw new Error('Amount received must be greater than 0');
    }
    if (!Number.isFinite(recvRate) || recvRate <= 0) {
      res.status(400);
      throw new Error('Exchange rate must be greater than 0');
    }
    const recvCurrency = (await resolveCurrency(req.body.received.currency, res)).code;
    received = { amount: recvAmount, currency: recvCurrency, rate: recvRate };
    amount = Math.round((recvAmount / recvRate) * 100) / 100;
  }
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
    currency: invoiceDoc.currency,
    exchangeRate: invoiceDoc.exchangeRate,
    received,
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
