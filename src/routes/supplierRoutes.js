const router = require('express').Router();
const {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  listActivities,
  createActivity,
  recordActivityPayment,
} = require('../controllers/supplierController');
const { protect, requirePermission, denyClients } = require('../middleware/auth');

router.use(protect, denyClients);

router.route('/activities').get(listActivities).post(requirePermission('suppliers', 'create'), createActivity);
router.post('/activities/:id/payment', requirePermission('suppliers', 'edit'), recordActivityPayment);
router.route('/').get(listSuppliers).post(requirePermission('suppliers', 'create'), createSupplier);
router
  .route('/:id')
  .get(getSupplier)
  .put(requirePermission('suppliers', 'edit'), updateSupplier)
  .delete(requirePermission('suppliers', 'delete'), deleteSupplier);

module.exports = router;
