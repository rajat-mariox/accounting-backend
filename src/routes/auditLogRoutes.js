const router = require('express').Router();
const { listAuditLogs } = require('../controllers/auditLogController');
const { protect, requirePermission, denyClients } = require('../middleware/auth');

router.use(protect, denyClients);
router.get('/', requirePermission('auditLogs', 'view'), listAuditLogs);

module.exports = router;
