const router = require('express').Router();
const { getAllSettings, getSetting, updateSetting } = require('../controllers/settingsController');
const { protect, requirePermission } = require('../middleware/auth');

router.use(protect);

router.get('/', getAllSettings);
router.get('/:key', getSetting);
router.put('/:key', requirePermission('settings', 'edit'), updateSetting);

module.exports = router;
