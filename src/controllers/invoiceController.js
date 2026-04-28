const asyncHandler = require('express-async-handler');
const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const { recordAudit } = require('../middleware/audit');
const notificationService = require('../services/notificationService');

function calculateAmount(items = []) {
  return items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
}

// GET /api/invoices
const listInvoices = asyncHandler(async (req, res) => {
  const { status, q } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (q) filter.clientName = { $regex: q, $options: 'i' };
  const invoices = await Invoice.find(filter).sort({ createdDate: -1 });
  res.json(invoices);
});

// GET /api/invoices/:id
const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  res.json(invoice);
});

// POST /api/invoices
const createInvoice = asyncHandler(async (req, res) => {
  const { client, dueDate, items, status, notes, createdDate } = req.body;
  if (!client || !dueDate || !Array.isArray(items) || items.length === 0) {
    res.status(400);
    throw new Error('client, dueDate, and at least one line item are required');
  }
  const clientDoc = await Client.findById(client);
  if (!clientDoc) {
    res.status(404);
    throw new Error('Client not found');
  }
  const amount = calculateAmount(items);
  const invoice = await Invoice.create({
    client: clientDoc._id,
    clientName: clientDoc.name,
    createdDate: createdDate || new Date(),
    dueDate,
    items,
    amount,
    status: status || 'pending',
    notes,
  });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Invoices',
    details: `Created invoice ${invoice.invoiceNumber} for ${clientDoc.name}`,
  });
  await notificationService.notifyInvoiceCreated(invoice);
  res.status(201).json(invoice);
});

// PUT /api/invoices/:id
const updateInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  const { client, dueDate, items, status, notes, createdDate } = req.body;
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
  if (notes !== undefined) invoice.notes = notes;
  if (status !== undefined) invoice.status = status;
  if (Array.isArray(items)) {
    invoice.items = items;
    invoice.amount = calculateAmount(items);
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
  invoice.status = status;
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
  await invoice.deleteOne();
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Invoices',
    details: `Deleted invoice ${invoice.invoiceNumber}`,
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
