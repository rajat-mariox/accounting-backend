const router = require('express').Router();
const {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} = require('../controllers/userController');
const { protect, requirePermission, denyClients } = require('../middleware/auth');

router.use(protect, denyClients);

router.get('/', requirePermission('users', 'view'), listUsers);
router.get('/:id', requirePermission('users', 'view'), getUser);
router.post('/', requirePermission('users', 'create'), createUser);
router.put('/:id', requirePermission('users', 'edit'), updateUser);
router.delete('/:id', requirePermission('users', 'delete'), deleteUser);

module.exports = router;
