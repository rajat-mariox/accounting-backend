const asyncHandler = require('express-async-handler');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Client = require('../models/Client');
const InventoryItem = require('../models/InventoryItem');

// GET /api/reports/dashboard
const dashboardSummary = asyncHandler(async (_req, res) => {
  const [invoiceAgg, paymentAgg, clientCount, itemCount, lowStockCount, recentInvoices] =
    await Promise.all([
      Invoice.aggregate([
        {
          $group: {
            _id: '$status',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      Payment.aggregate([
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Client.countDocuments(),
      InventoryItem.countDocuments(),
      InventoryItem.countDocuments({ $expr: { $lte: ['$stock', '$lowStockThreshold'] } }),
      Invoice.find().sort({ createdDate: -1 }).limit(5),
    ]);

  const byStatus = Object.fromEntries(invoiceAgg.map((s) => [s._id, s]));
  const totalRevenue = paymentAgg[0]?.total || 0;
  const outstanding =
    (byStatus.pending?.total || 0) + (byStatus.overdue?.total || 0);

  res.json({
    totalRevenue,
    outstanding,
    paidInvoices: byStatus.paid?.count || 0,
    pendingInvoices: byStatus.pending?.count || 0,
    overdueInvoices: byStatus.overdue?.count || 0,
    clients: clientCount,
    inventoryItems: itemCount,
    lowStockItems: lowStockCount,
    recentInvoices,
  });
});

// GET /api/reports/sales?from=&to=
const salesReport = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const match = {};
  if (from || to) {
    match.createdDate = {};
    if (from) match.createdDate.$gte = new Date(from);
    if (to) match.createdDate.$lte = new Date(to);
  }
  const rows = await Invoice.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          year: { $year: '$createdDate' },
          month: { $month: '$createdDate' },
        },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);
  res.json(rows);
});

// GET /api/reports/top-clients
const topClients = asyncHandler(async (_req, res) => {
  const rows = await Invoice.aggregate([
    {
      $group: {
        _id: '$client',
        clientName: { $first: '$clientName' },
        total: { $sum: '$amount' },
        invoices: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
    { $limit: 10 },
  ]);
  res.json(rows);
});

module.exports = { dashboardSummary, salesReport, topClients };
