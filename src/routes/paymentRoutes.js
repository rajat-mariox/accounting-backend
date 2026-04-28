const router = require('express').Router();
const { listPayments, createPayment, deletePayment } = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/').get(listPayments).post(createPayment);
router.delete('/:id', deletePayment);

module.exports = router;
