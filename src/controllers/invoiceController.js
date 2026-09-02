const asyncHandler = require('express-async-handler');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const Payment = require('../models/Payment');
const { recordAudit } = require('../middleware/audit');
const notificationService = require('../services/notificationService');
const stockService = require('../services/stockService');

function parsePercent(value, label, res) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    res.status(400);
    throw new Error(`${label} must be between 0 and 100`);
  }
  return n;
}

// GET /api/invoices
const listInvoices = asyncHandler(async (req, res) => {
  const { status, q } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (q) filter.clientName = { $regex: q, $options: 'i' };
  // Client portal logins only ever see their own invoices.
  if (req.user.role === 'Client') filter.client = req.user.client;
  const invoices = await Invoice.find(filter).sort({ createdDate: -1 });
  res.json(invoices);
});

// GET /api/invoices/:id
const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice || (req.user.role === 'Client' && String(invoice.client) !== String(req.user.client))) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  res.json(invoice);
});

// POST /api/invoices
const createInvoice = asyncHandler(async (req, res) => {
  const { client, dueDate, items, status, notes, createdDate, discountPercent, taxRate, initialPayment, nextPaymentDate } = req.body;
  if (!client || !dueDate || !Array.isArray(items) || items.length === 0) {
    res.status(400);
    throw new Error('client, dueDate, and at least one line item are required');
  }
  const clientDoc = await Client.findById(client);
  if (!clientDoc) {
    res.status(404);
    throw new Error('Client not found');
  }
  // Discount and tax default to the client's settings but can be overridden per invoice.
  const totals = Invoice.computeTotals(
    items,
    parsePercent(discountPercent, 'Discount', res) ?? clientDoc.discountPercent ?? 0,
    parsePercent(taxRate, 'Tax rate', res) ?? clientDoc.taxRate ?? 0
  );
  // Optional amount handed over by the client at invoice time; validated before anything is written.
  const paidNow = Number(initialPayment?.amount) || 0;
  if (paidNow > 0) {
    if (status === 'cancelled') {
      res.status(400);
      throw new Error('Cannot record a payment on a cancelled invoice');
    }
    if (!Number.isFinite(paidNow) || paidNow < 0) {
      res.status(400);
      throw new Error('Initial payment amount must be greater than 0');
    }
    if (paidNow > totals.amount + 0.005) {
      res.status(400);
      throw new Error(`Initial payment exceeds the invoice total of ${totals.amount.toFixed(2)}`);
    }
    if (!Payment.PAYMENT_MODES.includes(initialPayment?.mode)) {
      res.status(400);
      throw new Error(`Payment mode must be one of: ${Payment.PAYMENT_MODES.join(', ')}`);
    }
  }
  // Stock is committed at invoice time regardless of payment; reject if it isn't there.
  const updatedItems = status === 'cancelled' ? [] : await stockService.deductStock(items, res);
  const invoice = await Invoice.create({
    client: clientDoc._id,
    clientName: clientDoc.name,
    createdDate: createdDate || new Date(),
    dueDate,
    items,
    ...totals,
    amountPaid: 0,
    status: status || 'pending',
    stockDeducted: status !== 'cancelled',
    notes,
    nextPaymentDate: nextPaymentDate || undefined,
  });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Invoices',
    details: `Created invoice ${invoice.invoiceNumber} for ${clientDoc.name}`,
  });
  await notificationService.notifyInvoiceCreated(invoice);
  // Record the amount the client paid up front as a normal payment so it shows
  // in the Payments module and drives the partial/paid status.
  if (paidNow > 0) {
    const payment = await Payment.create({
      invoice: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      amount: paidNow,
      mode: initialPayment.mode,
      reference: initialPayment.reference,
      date: invoice.createdDate,
    });
    invoice.applyPaid(paidNow);
    await invoice.save();
    await recordAudit({
      user: req.user,
      action: 'Create',
      module: 'Payments',
      details: `Recorded payment of ${paidNow} for ${invoice.invoiceNumber}`,
    });
    await notificationService.notifyPaymentRecorded(payment, invoice);
    if (invoice.status === 'paid') {
      await notificationService.notifyInvoicePaid(invoice);
    }
  }
  res.status(201).json({ ...invoice.toObject(), updatedItems });
});

// PUT /api/invoices/:id
const updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  const { client, dueDate, items, status, notes, createdDate, discountPercent, taxRate, nextPaymentDate } = req.body;
  if (client && String(client) !== String(invoice.client)) {
    const clientDoc = await Client.findById(client);
    if (!clientDoc) {
      res.status(404);
      throw new Error('Client not found');
    }
    invoice.client = clientDoc._id;
    invoice.clientName = clientDoc.name;
  }
  if (dueDate !== undefined) invoice.dueDate = dueDate;
  if (createdDate !== undefined) invoice.createdDate = createdDate;
  if (nextPaymentDate !== undefined) invoice.nextPaymentDate = nextPaymentDate || undefined;
  if (notes !== undefined) invoice.notes = notes;
  if (status !== undefined) invoice.status = status;
  if (Array.isArray(items)) {
    // Re-commit stock for the new lines: give back the old quantities, then take the new ones.
    if (invoice.stockDeducted) {
      await stockService.restoreStock(invoice.items);
      invoice.stockDeducted = false;
    }
    if (invoice.status !== 'cancelled') {
      await stockService.deductStock(items, res);
      invoice.stockDeducted = true;
    }
    invoice.items = items;
  }
  const nextDiscount = parsePercent(discountPercent, 'Discount', res);
  const nextTax = parsePercent(taxRate, 'Tax rate', res);
  if (Array.isArray(items) || nextDiscount !== undefined || nextTax !== undefined) {
    Object.assign(
      invoice,
      Invoice.computeTotals(invoice.items, nextDiscount ?? invoice.discountPercent, nextTax ?? invoice.taxRate)
    );
    invoice.applyPaid(invoice.amountPaid);
  }
  await invoice.save();
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Invoices',
    details: `Updated invoice ${invoice.invoiceNumber}`,
  });
  res.json(invoice);
});

// PATCH /api/invoices/:id/status
const updateInvoiceStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status) {
    res.status(400);
    throw new Error('status is required');
  }
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  if (status === 'cancelled' && invoice.stockDeducted) {
    await stockService.restoreStock(invoice.items);
    invoice.stockDeducted = false;
  } else if (status !== 'cancelled' && !invoice.stockDeducted) {
    await stockService.deductStock(invoice.items, res);
    invoice.stockDeducted = true;
  }
  invoice.status = status;
  // "Mark paid" settles the full amount; reopening keeps whatever was actually paid.
  if (status === 'paid') {
    invoice.amountPaid = invoice.amount;
    invoice.nextPaymentDate = undefined;
  } else if (status !== 'cancelled') invoice.applyPaid(invoice.amountPaid);
  await invoice.save();
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Invoices',
    details: `Set invoice ${invoice.invoiceNumber} to ${status}`,
  });
  if (status === 'paid') {
    await notificationService.notifyInvoicePaid(invoice);
  }
  res.json(invoice);
});

// DELETE /api/invoices/:id
const deleteInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  if (invoice.stockDeducted) await stockService.restoreStock(invoice.items);
  await invoice.deleteOne();
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Invoices',
    details: `Deleted invoice ${invoice.invoiceNumber} (stock returned to inventory)`,
  });
  res.json({ message: 'Invoice deleted' });
});

module.exports = {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  updateInvoiceStatus,
  deleteInvoice,
};
