const router = require('express').Router();
const { dashboardSummary, salesReport, salesVsPurchase, topClients } = require('../controllers/reportController');
const { protect, denyClients } = require('../middleware/auth');

router.use(protect, denyClients);

router.get('/dashboard', dashboardSummary);
router.get('/sales', salesReport);
router.get('/sales-vs-purchase', salesVsPurchase);
router.get('/top-clients', topClients);

module.exports = router;
