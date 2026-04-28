const router = require('express').Router();
const {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  updateInvoiceStatus,
  deleteInvoice,
} = require('../controllers/invoiceController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/').get(listInvoices).post(createInvoice);
router.route('/:id').get(getInvoice).put(updateInvoice).delete(deleteInvoice);
router.patch('/:id/status', updateInvoiceStatus);

module.exports = router;
