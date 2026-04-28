const router = require('express').Router();
const {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  removeNotification,
  clearRead,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', listNotifications);
router.get('/unread-count', unreadCount);
router.post('/read-all', markAllRead);
router.post('/:id/read', markRead);
router.delete('/:id', removeNotification);
router.delete('/', clearRead);

module.exports = router;
