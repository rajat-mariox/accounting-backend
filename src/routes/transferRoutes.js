const router = require('express').Router();
const { listTransfers, createTransfer } = require('../controllers/transferController');
const { protect, requirePermission, denyClients } = require('../middleware/auth');

router.use(protect, denyClients);

router.route('/').get(listTransfers).post(requirePermission('inventory', 'create'), createTransfer);

module.exports = router;
