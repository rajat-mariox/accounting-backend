const router = require('express').Router();
const {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.get('/', listUsers);
router.get('/:id', getUser);
router.post('/', authorize('Administrator'), createUser);
router.put('/:id', authorize('Administrator'), updateUser);
router.delete('/:id', authorize('Administrator'), deleteUser);

module.exports = router;
