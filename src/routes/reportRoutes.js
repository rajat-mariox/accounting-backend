const router = require('express').Router();
const { dashboardSummary, salesReport, salesVsPurchase, topClients } = require('../controllers/reportController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/dashboard', dashboardSummary);
router.get('/sales', salesReport);
router.get('/sales-vs-purchase', salesVsPurchase);
router.get('/top-clients', topClients);

module.exports = router;
