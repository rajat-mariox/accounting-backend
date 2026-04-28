const router = require('express').Router();
const { listTransfers, createTransfer } = require('../controllers/transferController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.route('/').get(listTransfers).post(createTransfer);

module.exports = router;
