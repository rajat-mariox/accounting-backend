const router = require('express').Router();
const {
  register,
  login,
  me,
  changePassword,
  forgotPassword,
  verifyOtp,
  resetPassword,
} = require('../controllers/authController');
const { protect, requirePermission } = require('../middleware/auth');

// Public self-registration is disabled: new users are created from the admin
// panel by someone holding users.create permission.
router.post('/register', protect, requirePermission('users', 'create'), register);
router.post('/login', login);
router.get('/me', protect, me);
router.post('/change-password', protect, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);

module.exports = router;
