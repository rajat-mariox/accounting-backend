const router = require('express').Router();
const {
  listItems,
  stockOverview,
  stockDistribution,
  getItem,
  createItem,
  updateItem,
  deleteItem,
} = require('../controllers/inventoryController');
const { protect, requirePermission, denyClients } = require('../middleware/auth');

router.use(protect, denyClients);

router.get('/overview', stockOverview);
router.get('/distribution', stockDistribution);
router.route('/').get(listItems).post(requirePermission('inventory', 'create'), createItem);
router
  .route('/:id')
  .get(getItem)
  .put(requirePermission('inventory', 'edit'), updateItem)
  .delete(requirePermission('inventory', 'delete'), deleteItem);

module.exports = router;
