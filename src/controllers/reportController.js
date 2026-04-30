const asyncHandler = require('express-async-handler');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Client = require('../models/Client');
const InventoryItem = require('../models/InventoryItem');
const { SupplyActivity } = require('../models/Supplier');

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

// GET /api/reports/sales-vs-purchase?months=6&year=YYYY
// Returns `months` months starting from January of the requested year (default: current year).
const salesVsPurchase = asyncHandler(async (req, res) => {
  const months = Math.min(Math.max(parseInt(req.query.months, 10) || 6, 1), 24);
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const since = new Date(year, 0, 1, 0, 0, 0, 0);
  const until = new Date(year, months, 1, 0, 0, 0, 0);

  const [salesAgg, purchaseAgg] = await Promise.all([
    Invoice.aggregate([
      { $match: { createdDate: { $gte: since, $lt: until } } },
      {
        $group: {
          _id: { y: { $year: '$createdDate' }, m: { $month: '$createdDate' } },
          total: { $sum: '$amount' },
        },
      },
    ]),
    SupplyActivity.aggregate([
      { $match: { date: { $gte: since, $lt: until } } },
      {
        $group: {
          _id: { y: { $year: '$date' }, m: { $month: '$date' } },
          total: { $sum: '$totalAmount' },
        },
      },
    ]),
  ]);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const salesMap = new Map(salesAgg.map((r) => [`${r._id.y}-${r._id.m}`, r.total]));
  const purchaseMap = new Map(purchaseAgg.map((r) => [`${r._id.y}-${r._id.m}`, r.total]));

  const labels = [];
  const sales = [];
  const purchases = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(since.getFullYear(), since.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    labels.push(monthNames[d.getMonth()]);
    sales.push(salesMap.get(key) || 0);
    purchases.push(purchaseMap.get(key) || 0);
  }

  res.json({ labels, sales, purchases });
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

module.exports = { dashboardSummary, salesReport, salesVsPurchase, topClients };
