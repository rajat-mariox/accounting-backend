const router = require('express').Router();
const { listAuditLogs } = require('../controllers/auditLogController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.get('/', authorize('Administrator', 'Manager'), listAuditLogs);

module.exports = router;
