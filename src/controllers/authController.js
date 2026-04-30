const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { recordAudit } = require('../middleware/audit');

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const RESET_SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateOtp() {
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_FIXED_OTP) {
    return String(process.env.DEV_FIXED_OTP);
  }
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// POST /api/auth/register
const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role } = req.body;
  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Name, email, and password are required');
  }

  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) {
    res.status(409);
    throw new Error('Email already registered');
  }

  const user = await User.create({
    name,
    email,
    password,
    phone,
    role: role || 'Accountant',
  });

  await recordAudit({
    user,
    action: 'Create',
    module: 'Users',
    details: `Registered new user: ${user.name}`,
  });

  res.status(201).json({
    user: sanitize(user),
    token: generateToken(user._id),
  });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400);
    throw new Error('Email and password are required');
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.matchPassword(password))) {
    res.status(401);
    throw new Error('Invalid credentials');
  }
  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Account is inactive');
  }

  user.lastLogin = new Date();
  await user.save();

  await recordAudit({
    user,
    action: 'Login',
    module: 'Auth',
    details: `${user.name} signed in`,
  });

  res.json({
    user: sanitize(user),
    token: generateToken(user._id),
  });
});

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
  res.json({ user: sanitize(req.user) });
});

// POST /api/auth/change-password (protected)
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400);
    throw new Error('Current and new password are required');
  }
  if (String(newPassword).length < 6) {
    res.status(400);
    throw new Error('New password must be at least 6 characters');
  }
  if (currentPassword === newPassword) {
    res.status(400);
    throw new Error('New password must be different from current password');
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  const ok = await user.matchPassword(currentPassword);
  if (!ok) {
    res.status(401);
    throw new Error('Current password is incorrect');
  }

  user.password = newPassword;
  await user.save();

  await recordAudit({
    user,
    action: 'Update',
    module: 'Auth',
    details: `${user.name} changed their password`,
  });

  res.json({ message: 'Password updated' });
});

// POST /api/auth/forgot-password
// Step 1: validate the email belongs to an active account, then issue an OTP.
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400);
    throw new Error('Email is required');
  }

  const user = await User.findOne({ email: String(email).toLowerCase() }).select(
    '+resetOtpHash +resetOtpExpiresAt +resetOtpAttempts',
  );
  if (!user) {
    res.status(404);
    throw new Error('No account is registered with this email');
  }
  if (user.status !== 'active') {
    res.status(403);
    throw new Error('This account is inactive. Contact your administrator.');
  }

  const otp = generateOtp();
  user.resetOtpHash = hashSecret(otp);
  user.resetOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
  user.resetOtpAttempts = 0;
  user.resetSessionTokenHash = undefined;
  user.resetSessionExpiresAt = undefined;
  await user.save();

  // No mail transport is configured. Log to server console for now.
  // eslint-disable-next-line no-console
  console.log(`[auth] Password reset OTP for ${user.email}: ${otp} (expires in 10 min)`);

  res.json({
    message: 'A verification code has been sent.',
    ...(process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
  });
});

// POST /api/auth/verify-otp
// Step 2: verify the OTP and return a short-lived reset session token.
const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    res.status(400);
    throw new Error('Email and code are required');
  }

  const user = await User.findOne({ email: String(email).toLowerCase() }).select(
    '+resetOtpHash +resetOtpExpiresAt +resetOtpAttempts +resetSessionTokenHash +resetSessionExpiresAt',
  );
  if (!user || !user.resetOtpHash || !user.resetOtpExpiresAt) {
    res.status(400);
    throw new Error('Invalid or expired code');
  }

  if (user.resetOtpExpiresAt.getTime() < Date.now()) {
    user.resetOtpHash = undefined;
    user.resetOtpExpiresAt = undefined;
    user.resetOtpAttempts = 0;
    await user.save();
    res.status(400);
    throw new Error('Code has expired. Request a new one.');
  }

  if ((user.resetOtpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
    user.resetOtpHash = undefined;
    user.resetOtpExpiresAt = undefined;
    user.resetOtpAttempts = 0;
    await user.save();
    res.status(429);
    throw new Error('Too many attempts. Request a new code.');
  }

  if (user.resetOtpHash !== hashSecret(otp)) {
    user.resetOtpAttempts = (user.resetOtpAttempts || 0) + 1;
    await user.save();
    res.status(400);
    throw new Error('Invalid or expired code');
  }

  // OTP good — issue a one-time reset session token
  const sessionToken = crypto.randomBytes(32).toString('hex');
  user.resetSessionTokenHash = hashSecret(sessionToken);
  user.resetSessionExpiresAt = new Date(Date.now() + RESET_SESSION_TTL_MS);
  user.resetOtpHash = undefined;
  user.resetOtpExpiresAt = undefined;
  user.resetOtpAttempts = 0;
  await user.save();

  res.json({ resetToken: sessionToken });
});

// POST /api/auth/reset-password
// Step 3: exchange reset session token for a password update.
const resetPassword = asyncHandler(async (req, res) => {
  const { email, resetToken, newPassword } = req.body;
  if (!email || !resetToken || !newPassword) {
    res.status(400);
    throw new Error('Email, reset token, and new password are required');
  }
  if (String(newPassword).length < 6) {
    res.status(400);
    throw new Error('Password must be at least 6 characters');
  }

  const user = await User.findOne({ email: String(email).toLowerCase() }).select(
    '+password +resetSessionTokenHash +resetSessionExpiresAt',
  );
  if (
    !user ||
    !user.resetSessionTokenHash ||
    !user.resetSessionExpiresAt ||
    user.resetSessionExpiresAt.getTime() < Date.now() ||
    user.resetSessionTokenHash !== hashSecret(resetToken)
  ) {
    res.status(400);
    throw new Error('Reset session is invalid or has expired. Start over.');
  }

  user.password = newPassword;
  user.resetSessionTokenHash = undefined;
  user.resetSessionExpiresAt = undefined;
  user.resetOtpHash = undefined;
  user.resetOtpExpiresAt = undefined;
  user.resetOtpAttempts = 0;
  await user.save();

  await recordAudit({
    user,
    action: 'Update',
    module: 'Auth',
    details: `${user.name} reset their password via OTP`,
  });

  res.json({ message: 'Password has been reset. You can now sign in.' });
});

function sanitize(user) {
  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  delete obj.resetOtpHash;
  delete obj.resetOtpExpiresAt;
  delete obj.resetOtpAttempts;
  delete obj.resetSessionTokenHash;
  delete obj.resetSessionExpiresAt;
  return obj;
}

module.exports = {
  register,
  login,
  me,
  changePassword,
  forgotPassword,
  verifyOtp,
  resetPassword,
};
