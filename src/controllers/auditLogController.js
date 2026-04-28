const asyncHandler = require('express-async-handler');
const AuditLog = require('../models/AuditLog');

// GET /api/audit-logs
const listAuditLogs = asyncHandler(async (req, res) => {
  const { module, action, user, limit } = req.query;
  const filter = {};
  if (module) filter.module = module;
  if (action) filter.action = action;
  if (user) filter.user = { $regex: user, $options: 'i' };
  const logs = await AuditLog.find(filter)
    .sort({ timestamp: -1 })
    .limit(Math.min(Number(limit) || 200, 1000));
  res.json(logs);
});

module.exports = { listAuditLogs };
