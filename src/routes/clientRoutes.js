const router = require('express').Router();
const {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
} = require('../controllers/clientController');
const { protect, requirePermission, denyClients } = require('../middleware/auth');

router.use(protect, denyClients);

router.route('/').get(listClients).post(requirePermission('clients', 'create'), createClient);
router
  .route('/:id')
  .get(getClient)
  .put(requirePermission('clients', 'edit'), updateClient)
  .delete(requirePermission('clients', 'delete'), deleteClient);

module.exports = router;
