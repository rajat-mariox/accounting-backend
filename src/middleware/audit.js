const AuditLog = require('../models/AuditLog');

const TONE_BY_ACTION = {
  Create: 'create',
  Update: 'update',
  Delete: 'delete',
  Login: 'create',
};

async function recordAudit({ user, action, module, details }) {
  try {
    await AuditLog.create({
      user: user?.name || 'System',
      userId: user?._id,
      action,
      module,
      details,
      tone: TONE_BY_ACTION[action] || 'update',
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('Failed to record audit log:', err.message);
  }
}

module.exports = { recordAudit };
