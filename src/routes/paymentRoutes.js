const router = require('express').Router();
const { listPayments, createPayment, deletePayment } = require('../controllers/paymentController');
const { protect, requirePermission } = require('../middleware/auth');

router.use(protect);

router.route('/').get(listPayments).post(requirePermission('payments', 'create'), createPayment);
router.delete('/:id', requirePermission('payments', 'delete'), deletePayment);

module.exports = router;
