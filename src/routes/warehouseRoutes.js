const router = require('express').Router();
const {
  listWarehouses,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
} = require('../controllers/warehouseController');
const { protect, requirePermission, denyClients } = require('../middleware/auth');

router.use(protect, denyClients);

router.route('/').get(listWarehouses).post(requirePermission('inventory', 'create'), createWarehouse);
router
  .route('/:id')
  .put(requirePermission('inventory', 'edit'), updateWarehouse)
  .delete(requirePermission('inventory', 'delete'), deleteWarehouse);

module.exports = router;
