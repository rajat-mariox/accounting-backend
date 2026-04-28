const router = require('express').Router();
const {
  listWarehouses,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
} = require('../controllers/warehouseController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/').get(listWarehouses).post(createWarehouse);
router.route('/:id').put(updateWarehouse).delete(deleteWarehouse);

module.exports = router;
