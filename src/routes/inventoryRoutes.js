const router = require('express').Router();
const {
  listItems,
  stockOverview,
  getItem,
  createItem,
  updateItem,
  deleteItem,
} = require('../controllers/inventoryController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/overview', stockOverview);
router.route('/').get(listItems).post(createItem);
router.route('/:id').get(getItem).put(updateItem).delete(deleteItem);

module.exports = router;
