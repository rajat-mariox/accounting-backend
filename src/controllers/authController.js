const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { recordAudit } = require('../middleware/audit');

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

function sanitize(user) {
  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  return obj;
}

module.exports = { register, login, me };
