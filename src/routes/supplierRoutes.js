const router = require('express').Router();
const {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  listActivities,
  createActivity,
} = require('../controllers/supplierController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/activities').get(listActivities).post(createActivity);
router.route('/').get(listSuppliers).post(createSupplier);
router.route('/:id').get(getSupplier).put(updateSupplier).delete(deleteSupplier);

module.exports = router;
