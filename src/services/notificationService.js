const Notification = require('../models/Notification');
const InventoryItem = require('../models/InventoryItem');
const Invoice = require('../models/Invoice');
const { SupplyActivity, startOfToday } = require('../models/Supplier');

// Supplier payment reminders fire this many days before the promised date.
const SUPPLIER_ALERT_LEAD_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDay(date) {
  return date ? new Date(date).toISOString().slice(0, 10) : '';
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

// Create or update a notification. If `key` is provided, the operation is
// idempotent — calling with the same key won't duplicate, and won't overwrite
// the `read` flag if the user has already dismissed it.
async function emit({ title, description, tone = 'info', category = 'System', key, link, meta, client = null }) {
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
        existing.client = client;
        await existing.save();
        return existing;
      }
    }
    return await Notification.create({ title, description, tone, category, key, link, meta, client });
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

  // Overdue invoices: due date before today and not paid.
  const overdueInvoices = await Invoice.find({
    status: { $nin: ['paid', 'cancelled'] },
    dueDate: { $lt: startOfToday() },
  })
    .select('_id client invoiceNumber clientName amount amountPaid dueDate status')
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

  await refreshSupplierPaymentAlerts();
  await refreshClientInvoiceAlerts();
}

// Client-portal reminders for unpaid invoices: due within 3 days, or overdue.
// Scoped to the invoice's client so only that portal login sees them.
async function refreshClientInvoiceAlerts() {
  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const soon = new Date(today.getTime() + (SUPPLIER_ALERT_LEAD_DAYS + 1) * DAY_MS);

  const open = await Invoice.find({ status: { $nin: ['paid', 'cancelled'] }, dueDate: { $lt: soon } })
    .select('_id client invoiceNumber amount amountPaid dueDate')
    .lean();

  const jobs = [];
  const keep = new Set();
  for (const inv of open) {
    const balance = Math.max(0, Number(inv.amount) - Number(inv.amountPaid || 0));
    if (balance <= 0 || !inv.client) continue;
    if (inv.dueDate < today) {
      keep.add(`client-overdue:${inv._id}`);
      jobs.push(
        emit({
          title: 'Invoice Overdue',
          description: `Invoice ${inv.invoiceNumber} — ${money(balance)} was due on ${formatDay(inv.dueDate)}. Please arrange payment.`,
          tone: 'danger',
          category: 'Overdue',
          key: `client-overdue:${inv._id}`,
          link: '/invoices',
          client: inv.client,
          meta: { invoiceId: inv._id, balance, dueDate: inv.dueDate },
        })
      );
    } else {
      keep.add(`client-due:${inv._id}`);
      const dueToday = inv.dueDate < tomorrow;
      jobs.push(
        emit({
          title: dueToday ? 'Invoice Due Today' : 'Invoice Due Soon',
          description: dueToday
            ? `Invoice ${inv.invoiceNumber} — ${money(balance)} is due today.`
            : `Invoice ${inv.invoiceNumber} — ${money(balance)} is due on ${formatDay(inv.dueDate)}.`,
          tone: 'warning',
          category: 'Invoice',
          key: `client-due:${inv._id}`,
          link: '/invoices',
          client: inv.client,
          meta: { invoiceId: inv._id, balance, dueDate: inv.dueDate },
        })
      );
    }
  }
  await Promise.all(jobs);

  // Remove reminders that no longer apply (paid, cancelled, date moved, or state changed).
  const stale = await Notification.find({ key: { $regex: /^client-(due|overdue):/ } }).select('key').lean();
  const staleKeys = stale.map((n) => n.key).filter((k) => !keep.has(k));
  if (staleKeys.length > 0) await Notification.deleteMany({ key: { $in: staleKeys } });
}

// Supplier balances: remind admins before the promised payment date and flag it once missed.
async function refreshSupplierPaymentAlerts() {
  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const soon = new Date(today.getTime() + (SUPPLIER_ALERT_LEAD_DAYS + 1) * DAY_MS);

  const open = await SupplyActivity.find({
    $expr: { $gt: ['$totalAmount', { $ifNull: ['$amountPaid', 0] }] },
    nextPaymentDate: { $ne: null },
  })
    .select('_id supplierName item totalAmount amountPaid nextPaymentDate paymentStatus')
    .lean();

  // Overdue = promised date is before today. Due soon = today .. today + lead days.
  const overdue = open.filter((a) => a.nextPaymentDate < today);
  const dueSoon = open.filter((a) => a.nextPaymentDate >= today && a.nextPaymentDate < soon);

  if (overdue.length > 0) {
    await SupplyActivity.updateMany(
      { _id: { $in: overdue.map((a) => a._id) } },
      { $set: { paymentStatus: 'overdue' } }
    );
  }
  // Dates pushed into the future again (or wrongly flagged) go back to partial/pending.
  const notOverdue = open.filter((a) => a.nextPaymentDate >= today && a.paymentStatus === 'overdue');
  for (const a of notOverdue) {
    await SupplyActivity.updateOne(
      { _id: a._id },
      { $set: { paymentStatus: Number(a.amountPaid) > 0 ? 'partial' : 'pending' } }
    );
  }

  await Promise.all([
    ...overdue.map((a) =>
      emit({
        title: 'Supplier Payment Overdue',
        description: `${money(a.totalAmount - (a.amountPaid || 0))} still owed to ${a.supplierName} for ${a.item} — was due ${formatDay(a.nextPaymentDate)}`,
        tone: 'danger',
        category: 'SupplierPayment',
        key: `supplier-overdue:${a._id}`,
        link: '/suppliers',
        meta: { activityId: a._id, dueDate: a.nextPaymentDate },
      })
    ),
    ...dueSoon.map((a) =>
      emit({
        title: a.nextPaymentDate < tomorrow ? 'Supplier Payment Due Today' : 'Supplier Payment Due Soon',
        description: a.nextPaymentDate < tomorrow
          ? `${money(a.totalAmount - (a.amountPaid || 0))} to ${a.supplierName} for ${a.item} is due today`
          : `${money(a.totalAmount - (a.amountPaid || 0))} to ${a.supplierName} for ${a.item} is due on ${formatDay(a.nextPaymentDate)}`,
        tone: 'warning',
        category: 'SupplierPayment',
        key: `supplier-due:${a._id}`,
        link: '/suppliers',
        meta: { activityId: a._id, dueDate: a.nextPaymentDate },
      })
    ),
  ]);

  // Once overdue, drop the "due soon" reminder for the same supply.
  if (overdue.length > 0) {
    await Notification.deleteMany({ key: { $in: overdue.map((a) => `supplier-due:${a._id}`) } });
  }

  // Clear reminders for supplies that are now settled or had their date pushed out.
  const openIds = new Set(open.map((a) => String(a._id)));
  const dueSoonIds = new Set(dueSoon.map((a) => String(a._id)));
  const overdueIds = new Set(overdue.map((a) => String(a._id)));
  const stale = await Notification.find({ key: { $regex: /^supplier-(due|overdue):/ } })
    .select('key')
    .lean();
  const staleKeys = stale
    .filter((n) => {
      const [kind, id] = n.key.split(':');
      if (!openIds.has(id)) return true;
      if (kind === 'supplier-due') return !dueSoonIds.has(id);
      return !overdueIds.has(id);
    })
    .map((n) => n.key);
  if (staleKeys.length > 0) {
    await Notification.deleteMany({ key: { $in: staleKeys } });
  }
}

async function notifySupplyRecorded(activity) {
  const balance = Math.max(0, Number(activity.totalAmount) - Number(activity.amountPaid || 0));
  const description = balance > 0
    ? `${activity.item} x${activity.quantity} from ${activity.supplierName}: paid ${money(activity.amountPaid)}, ${money(balance)} remaining, next payment ${formatDay(activity.nextPaymentDate)}`
    : `${activity.item} x${activity.quantity} from ${activity.supplierName}: ${money(activity.totalAmount)} paid in full`;
  return emit({
    title: 'Supply Recorded',
    description,
    tone: balance > 0 ? 'info' : 'success',
    category: 'SupplierPayment',
    link: '/suppliers',
    meta: { activityId: activity._id, balance, nextPaymentDate: activity.nextPaymentDate },
  });
}

async function notifySupplyPaymentRecorded(activity, amount) {
  const balance = Math.max(0, Number(activity.totalAmount) - Number(activity.amountPaid || 0));
  await Notification.deleteMany({
    key: { $in: [`supplier-due:${activity._id}`, `supplier-overdue:${activity._id}`] },
  });
  return emit({
    title: balance > 0 ? 'Supplier Installment Paid' : 'Supplier Fully Paid',
    description: balance > 0
      ? `Paid ${money(amount)} to ${activity.supplierName} for ${activity.item}; ${money(balance)} remaining, next payment ${formatDay(activity.nextPaymentDate)}`
      : `Paid ${money(amount)} to ${activity.supplierName} for ${activity.item}; balance cleared`,
    tone: 'success',
    category: 'SupplierPayment',
    link: '/suppliers',
    meta: { activityId: activity._id, amount, balance },
  });
}

// Convenience helpers for write-paths in other controllers.
async function notifyInvoiceCreated(invoice) {
  if (invoice.client) {
    await emit({
      title: 'New Invoice',
      description: `Invoice ${invoice.invoiceNumber} for ${money(invoice.amount)} is due on ${formatDay(invoice.dueDate)}`,
      tone: 'info',
      category: 'Invoice',
      link: '/invoices',
      client: invoice.client,
      meta: { invoiceId: invoice._id, amount: invoice.amount, dueDate: invoice.dueDate },
    });
  }
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
  if (invoice.client) {
    await Notification.deleteMany({ key: { $in: [`client-due:${invoice._id}`, `client-overdue:${invoice._id}`] } });
    await emit({
      title: 'Invoice Paid',
      description: `Thank you — invoice ${invoice.invoiceNumber} is fully paid`,
      tone: 'success',
      category: 'Invoice',
      link: '/invoices',
      client: invoice.client,
      meta: { invoiceId: invoice._id, amount: invoice.amount },
    });
  }
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
  if (invoice?.client) {
    const balance = Math.max(0, Number(invoice.amount) - Number(invoice.amountPaid || 0));
    await emit({
      title: 'Payment Received',
      description: balance > 0
        ? `We received ${money(payment.amount)} for invoice ${invoice.invoiceNumber}; ${money(balance)} remains due on ${formatDay(invoice.dueDate)}`
        : `We received ${money(payment.amount)} for invoice ${invoice.invoiceNumber}`,
      tone: 'success',
      category: 'Payment',
      link: '/payments',
      client: invoice.client,
      meta: { paymentId: payment._id, invoiceId: invoice._id, amount: payment.amount, balance },
    });
  }
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
  refreshSupplierPaymentAlerts,
  notifyInvoiceCreated,
  notifyInvoicePaid,
  notifyPaymentRecorded,
  notifySupplyRecorded,
  notifySupplyPaymentRecorded,
};
