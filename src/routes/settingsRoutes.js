const router = require('express').Router();
const { getAllSettings, getSetting, updateSetting } = require('../controllers/settingsController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

router.get('/', getAllSettings);
router.get('/:key', getSetting);
router.put('/:key', authorize('Administrator'), updateSetting);

module.exports = router;
