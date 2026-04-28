const Notification = require('../models/Notification');
const InventoryItem = require('../models/InventoryItem');
const Invoice = require('../models/Invoice');

// Create or update a notification. If `key` is provided, the operation is
// idempotent — calling with the same key won't duplicate, and won't overwrite
// the `read` flag if the user has already dismissed it.
async function emit({ title, description, tone = 'info', category = 'System', key, link, meta }) {
  try {
    if (key) {
      const existing = await Notification.findOne({ key });
      if (existing) {
        existing.title = title;
        existing.description = description;
        existing.tone = tone;
        existing.category = category;
        existing.link = link;
        existing.meta = meta;
        await existing.save();
        return existing;
      }
    }
    return await Notification.create({ title, description, tone, category, key, link, meta });
  } catch (err) {
    if (err.code === 11000) {
      // Race on unique key — fall through and return existing.
      return Notification.findOne({ key });
    }
    console.error('Failed to emit notification:', err.message);
    return null;
  }
}

// Refresh derived alerts (low stock, overdue invoices). Idempotent.
async function refreshSystemAlerts() {
  // Low stock: any item where stock <= lowStockThreshold and stock > 0.
  const lowStockItems = await InventoryItem.find({
    $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] },
  })
    .select('_id name stock unit')
    .lean();

  // Out of stock.
  const outOfStockItems = await InventoryItem.find({ stock: { $lte: 0 } })
    .select('_id name unit')
    .lean();

  // Overdue invoices: dueDate < now and not paid.
  const overdueInvoices = await Invoice.find({
    status: { $nin: ['paid', 'cancelled'] },
    dueDate: { $lt: new Date() },
  })
    .select('_id invoiceNumber clientName amount dueDate status')
    .lean();

  // Mark them as overdue in the DB so the badge stays accurate.
  if (overdueInvoices.length > 0) {
    await Invoice.updateMany(
      { _id: { $in: overdueInvoices.map((i) => i._id) }, status: { $nin: ['paid', 'cancelled'] } },
      { $set: { status: 'overdue' } }
    );
  }

  await Promise.all([
    ...lowStockItems.map((item) =>
      emit({
        title: 'Low Stock Alert',
        description: `${item.name} is running low (${item.stock} ${item.unit || 'units'})`,
        tone: 'warning',
        category: 'LowStock',
        key: `low-stock:${item._id}`,
        link: '/inventory',
        meta: { itemId: item._id, stock: item.stock },
      })
    ),
    ...outOfStockItems.map((item) =>
      emit({
        title: 'Out of Stock',
        description: `${item.name} is out of stock`,
        tone: 'danger',
        category: 'LowStock',
        key: `out-of-stock:${item._id}`,
        link: '/inventory',
        meta: { itemId: item._id },
      })
    ),
    ...overdueInvoices.map((invoice) =>
      emit({
        title: 'Overdue Invoice',
        description: `Invoice ${invoice.invoiceNumber} for ${invoice.clientName} is overdue`,
        tone: 'danger',
        category: 'Overdue',
        key: `overdue:${invoice._id}`,
        link: '/invoices',
        meta: {
          invoiceId: invoice._id,
          amount: invoice.amount,
          dueDate: invoice.dueDate,
        },
      })
    ),
  ]);

  // Clear stale low-stock notifications: items that are now sufficiently stocked.
  const sufficientlyStocked = await InventoryItem.find({
    $expr: { $gt: ['$stock', '$lowStockThreshold'] },
  })
    .select('_id')
    .lean();
  if (sufficientlyStocked.length > 0) {
    await Notification.deleteMany({
      key: { $in: sufficientlyStocked.map((i) => `low-stock:${i._id}`) },
    });
    await Notification.deleteMany({
      key: { $in: sufficientlyStocked.map((i) => `out-of-stock:${i._id}`) },
    });
  }

  // Clear notifications for invoices that have since been paid.
  const paidInvoices = await Invoice.find({ status: 'paid' }).select('_id').lean();
  if (paidInvoices.length > 0) {
    await Notification.deleteMany({
      key: { $in: paidInvoices.map((i) => `overdue:${i._id}`) },
    });
  }
}

// Convenience helpers for write-paths in other controllers.
async function notifyInvoiceCreated(invoice) {
  return emit({
    title: 'New Invoice',
    description: `Invoice ${invoice.invoiceNumber} created for ${invoice.clientName}`,
    tone: 'info',
    category: 'Invoice',
    link: '/invoices',
    meta: { invoiceId: invoice._id, amount: invoice.amount },
  });
}

async function notifyInvoicePaid(invoice) {
  return emit({
    title: 'Invoice Paid',
    description: `Invoice ${invoice.invoiceNumber} for ${invoice.clientName} marked paid`,
    tone: 'success',
    category: 'Invoice',
    link: '/invoices',
    meta: { invoiceId: invoice._id, amount: invoice.amount },
  });
}

async function notifyPaymentRecorded(payment, invoice) {
  return emit({
    title: 'Payment Received',
    description: `Payment of ${payment.amount} recorded for ${invoice?.invoiceNumber || payment.invoiceNumber}`,
    tone: 'success',
    category: 'Payment',
    link: '/payments',
    meta: { paymentId: payment._id, invoiceId: payment.invoice, amount: payment.amount },
  });
}

module.exports = {
  emit,
  refreshSystemAlerts,
  notifyInvoiceCreated,
  notifyInvoicePaid,
  notifyPaymentRecorded,
};
