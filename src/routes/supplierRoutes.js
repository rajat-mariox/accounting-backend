const router = require('express').Router();
const {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  listActivities,
  listSupplierPayments,
  getActivityAttachment,
  getInstallmentAttachment,
  createActivity,
  recordActivityPayment,
} = require('../controllers/supplierController');
const { protect, requirePermission, denyClients } = require('../middleware/auth');

router.use(protect, denyClients);

router.get('/payments', listSupplierPayments);
router.route('/activities').get(listActivities).post(requirePermission('suppliers', 'create'), createActivity);
router.get('/activities/:id/attachment', getActivityAttachment);
router.get('/activities/:id/payments/:paymentId/attachment', getInstallmentAttachment);
router.post('/activities/:id/payment', requirePermission('suppliers', 'edit'), recordActivityPayment);
router.route('/').get(listSuppliers).post(requirePermission('suppliers', 'create'), createSupplier);
router
  .route('/:id')
  .get(getSupplier)
  .put(requirePermission('suppliers', 'edit'), updateSupplier)
  .delete(requirePermission('suppliers', 'delete'), deleteSupplier);

module.exports = router;
