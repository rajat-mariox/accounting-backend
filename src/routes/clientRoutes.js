const router = require('express').Router();
const {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
} = require('../controllers/clientController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/').get(listClients).post(createClient);
router.route('/:id').get(getClient).put(updateClient).delete(deleteClient);

module.exports = router;
