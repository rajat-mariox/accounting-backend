const router = require('express').Router();
const {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  updateInvoiceStatus,
  deleteInvoice,
} = require('../controllers/invoiceController');
const { protect, requirePermission } = require('../middleware/auth');

router.use(protect);

router.route('/').get(listInvoices).post(requirePermission('invoices', 'create'), createInvoice);
router
  .route('/:id')
  .get(getInvoice)
  .put(requirePermission('invoices', 'edit'), updateInvoice)
  .delete(requirePermission('invoices', 'delete'), deleteInvoice);
router.patch('/:id/status', requirePermission('invoices', 'edit'), updateInvoiceStatus);

module.exports = router;
