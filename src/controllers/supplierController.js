const asyncHandler = require('express-async-handler');
const { Supplier, SupplyActivity } = require('../models/Supplier');
const { recordAudit } = require('../middleware/audit');
const notificationService = require('../services/notificationService');
const { resolveCurrency, pickRate, toBaseExpr } = require('../services/currencyService');

function parseDate(value, label, res) {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    res.status(400);
    throw new Error(`${label} is not a valid date`);
  }
  return date;
}

// GET /api/suppliers
const listSuppliers = asyncHandler(async (req, res) => {
  const suppliers = await Supplier.find().sort({ createdAt: -1 }).lean();
  const activityAgg = await SupplyActivity.aggregate([
    {
      $group: {
        _id: '$supplier',
        activities: { $sum: 1 },
        // Supplies can be in different currencies, so totals are in the base currency.
        total: { $sum: toBaseExpr('$totalAmount') },
        paid: { $sum: toBaseExpr('$amountPaid') },
      },
    },
  ]);
  const map = new Map(activityAgg.map((a) => [String(a._id), a]));
  const enriched = suppliers.map((s) => {
    const a = map.get(String(s._id));
    const total = a?.total || 0;
    const paid = a?.paid || 0;
    return { ...s, activities: a?.activities || 0, total, paid, outstanding: Math.max(0, total - paid) };
  });
  res.json(enriched);
});

// GET /api/suppliers/:id
const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const activities = await SupplyActivity.find({ supplier: supplier._id }).sort({ date: -1 });
  res.json({ ...supplier.toObject(), activities });
});

// POST /api/suppliers
const createSupplier = asyncHandler(async (req, res) => {
  const { name, company, email, phone, address } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }
  const supplier = await Supplier.create({ name, company, email, phone, address });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Suppliers',
    details: `Added supplier: ${supplier.name}`,
  });
  res.status(201).json(supplier);
});

// PUT /api/suppliers/:id
const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  ['name', 'company', 'email', 'phone', 'address'].forEach((field) => {
    if (req.body[field] !== undefined) supplier[field] = req.body[field];
  });
  await supplier.save();
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Suppliers',
    details: `Updated supplier: ${supplier.name}`,
  });
  res.json(supplier);
});

// DELETE /api/suppliers/:id
const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  await supplier.deleteOne();
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Suppliers',
    details: `Deleted supplier: ${supplier.name}`,
  });
  res.json({ message: 'Supplier deleted' });
});

// GET /api/suppliers/activities/all
const listActivities = asyncHandler(async (_req, res) => {
  const activities = await SupplyActivity.find().sort({ date: -1 });
  res.json(activities);
});

// GET /api/suppliers/payments
// Every installment paid to a supplier, flattened across supply activities, newest first.
const listSupplierPayments = asyncHandler(async (_req, res) => {
  const activities = await SupplyActivity.find({ 'payments.0': { $exists: true } }).lean();
  const rows = [];
  for (const activity of activities) {
    for (const installment of activity.payments || []) {
      rows.push({
        id: String(installment._id),
        activity: String(activity._id),
        supplier: String(activity.supplier),
        supplierName: activity.supplierName,
        item: activity.item,
        invoiceNumber: activity.invoiceNumber,
        currency: activity.currency,
        exchangeRate: activity.exchangeRate,
        amount: installment.amount,
        date: installment.date,
        reference: installment.reference,
        attachment: installment.attachment
          ? { name: installment.attachment.name, mimeType: installment.attachment.mimeType, size: installment.attachment.size }
          : undefined,
      });
    }
  }
  // Newest first; installments on the same day by recording order (ObjectIds increase over time).
  rows.sort((a, b) => new Date(b.date) - new Date(a.date) || b.id.localeCompare(a.id));
  res.json(rows);
});

const ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

// Body field `attachment: { name, mimeType, data }` where data is base64.
// Returns undefined when nothing was attached; throws a 400 on bad input.
function parseAttachment(input, res) {
  if (!input || !input.data) return undefined;
  const mimeType = String(input.mimeType || '').toLowerCase();
  if (!ATTACHMENT_TYPES.includes(mimeType)) {
    res.status(400);
    throw new Error('Invoice attachment must be a PDF, PNG, JPG, or WEBP file');
  }
  const base64 = String(input.data).replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    res.status(400);
    throw new Error('Invoice attachment is empty');
  }
  if (buffer.length > ATTACHMENT_MAX_BYTES) {
    res.status(400);
    throw new Error('Invoice attachment must be 5 MB or smaller');
  }
  const name = String(input.name || 'supplier-invoice').trim().slice(0, 200);
  return { name, mimeType, size: buffer.length, data: buffer };
}

function sendAttachment(res, attachment) {
  const { name, mimeType, data } = attachment;
  res.set('Content-Type', mimeType || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${encodeURIComponent(name || 'supplier-invoice')}"`);
  res.send(data);
}

// GET /api/suppliers/activities/:id/attachment — streams the invoice attached to the supply.
const getActivityAttachment = asyncHandler(async (req, res) => {
  const activity = await SupplyActivity.findById(req.params.id).select('+attachment.data');
  if (!activity || !activity.attachment || !activity.attachment.data) {
    res.status(404);
    throw new Error('No invoice is attached to this supply');
  }
  sendAttachment(res, activity.attachment);
});

// GET /api/suppliers/activities/:id/payments/:paymentId/attachment — invoice attached to one installment.
const getInstallmentAttachment = asyncHandler(async (req, res) => {
  const activity = await SupplyActivity.findById(req.params.id).select('+payments.attachment.data');
  const installment = activity?.payments.id(req.params.paymentId);
  if (!installment || !installment.attachment || !installment.attachment.data) {
    res.status(404);
    throw new Error('No invoice is attached to this payment');
  }
  sendAttachment(res, installment.attachment);
});

// POST /api/suppliers/activities
// Body: { supplier, item, quantity, pricePerUnit, date?, invoiceNumber?, amountPaid?, nextPaymentDate? }
const createActivity = asyncHandler(async (req, res) => {
  const { supplier, item, quantity, pricePerUnit, date, invoiceNumber, amountPaid, nextPaymentDate } = req.body;
  const attachment = parseAttachment(req.body.attachment, res);
  const currencyInfo = await resolveCurrency(req.body.currency, res);
  const exchangeRate = pickRate(req.body.exchangeRate, currencyInfo.rate);
  if (!supplier || !item || !quantity || pricePerUnit === undefined) {
    res.status(400);
    throw new Error('supplier, item, quantity, and pricePerUnit are required');
  }
  const supplierDoc = await Supplier.findById(supplier);
  if (!supplierDoc) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const totalAmount = Math.round(Number(quantity) * Number(pricePerUnit) * 100) / 100;
  const paid = amountPaid === undefined || amountPaid === '' ? 0 : Number(amountPaid);
  if (!Number.isFinite(paid) || paid < 0) {
    res.status(400);
    throw new Error('Amount paid must be 0 or more');
  }
  if (paid > totalAmount + 0.005) {
    res.status(400);
    throw new Error(`Amount paid cannot exceed the total of ${totalAmount.toFixed(2)}`);
  }
  const remaining = Math.round((totalAmount - paid) * 100) / 100;
  const promised = parseDate(nextPaymentDate, 'Next payment date', res);
  if (remaining > 0 && !promised) {
    res.status(400);
    throw new Error('Next payment date is required while there is a remaining balance');
  }

  const activity = new SupplyActivity({
    supplier: supplierDoc._id,
    supplierName: supplierDoc.name,
    item,
    quantity,
    pricePerUnit,
    totalAmount,
    currency: currencyInfo.code,
    exchangeRate,
    date: date || new Date(),
    invoiceNumber: invoiceNumber ? String(invoiceNumber).trim() : undefined,
    amountPaid: paid,
    nextPaymentDate: remaining > 0 ? promised : undefined,
    payments: paid > 0 ? [{ amount: paid, date: date || new Date(), reference: 'Initial payment' }] : [],
    attachment,
  });
  activity.recomputeStatus();
  await activity.save();
  // Never echo the file bytes back in the JSON response.
  if (activity.attachment) activity.attachment.data = undefined;

  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Suppliers',
    details: `Recorded supply activity: ${item} x${quantity} (paid ${paid.toFixed(2)}, remaining ${remaining.toFixed(2)})${attachment ? `, invoice attached: ${attachment.name}` : ''}`,
  });
  await notificationService.notifySupplyRecorded(activity);
  res.status(201).json(activity);
});

// POST /api/suppliers/activities/:id/payment
// Body: { amount, date?, reference?, nextPaymentDate? } — record an installment to the supplier.
const recordActivityPayment = asyncHandler(async (req, res) => {
  const activity = await SupplyActivity.findById(req.params.id);
  if (!activity) {
    res.status(404);
    throw new Error('Supply activity not found');
  }
  const { amount, date, reference, nextPaymentDate } = req.body;
  const attachment = parseAttachment(req.body.attachment, res);
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    res.status(400);
    throw new Error('Amount must be greater than 0');
  }
  const balance = activity.balance;
  if (balance <= 0) {
    res.status(400);
    throw new Error('This supply is already fully paid');
  }
  if (value > balance + 0.005) {
    res.status(400);
    throw new Error(`Amount exceeds the remaining balance of ${balance.toFixed(2)}`);
  }
  const paidOn = parseDate(date, 'Payment date', res) || new Date();
  const remaining = Math.round((balance - value) * 100) / 100;
  const promised = parseDate(nextPaymentDate, 'Next payment date', res);
  if (remaining > 0 && !promised) {
    res.status(400);
    throw new Error('Next payment date is required while a balance remains');
  }

  activity.payments.push({ amount: value, date: paidOn, reference, attachment });
  activity.amountPaid = Math.round((Number(activity.amountPaid || 0) + value) * 100) / 100;
  activity.nextPaymentDate = remaining > 0 ? promised : undefined;
  activity.recomputeStatus();
  await activity.save();
  // Never echo the file bytes back in the JSON response.
  const added = activity.payments[activity.payments.length - 1];
  if (added.attachment) added.attachment.data = undefined;

  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Suppliers',
    details: `Paid ${value.toFixed(2)} to ${activity.supplierName} for ${activity.item} (remaining ${remaining.toFixed(2)})${attachment ? `, invoice attached: ${attachment.name}` : ''}`,
  });
  await notificationService.notifySupplyPaymentRecorded(activity, value);
  res.json(activity);
});

module.exports = {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  listActivities,
  listSupplierPayments,
  getActivityAttachment,
  getInstallmentAttachment,
  createActivity,
  recordActivityPayment,
};
