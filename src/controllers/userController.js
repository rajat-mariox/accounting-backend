const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const { recordAudit } = require('../middleware/audit');

// GET /api/users
const listUsers = asyncHandler(async (_req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json(users);
});

// GET /api/users/:id
const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  res.json(user);
});

// POST /api/users
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role, status } = req.body;
  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Name, email, and password are required');
  }
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) {
    res.status(409);
    throw new Error('Email already registered');
  }
  const user = await User.create({ name, email, password, phone, role, status });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Users',
    details: `Added new user: ${user.name}`,
  });
  res.status(201).json(user);
});

// PUT /api/users/:id
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  const { name, email, phone, role, status, password } = req.body;
  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (phone !== undefined) user.phone = phone;
  if (role !== undefined) user.role = role;
  if (status !== undefined) user.status = status;
  if (password) user.password = password;
  await user.save();
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Users',
    details: `Updated user: ${user.name}`,
  });
  res.json(user);
});

// DELETE /api/users/:id
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  await user.deleteOne();
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Users',
    details: `Deleted user: ${user.name}`,
  });
  res.json({ message: 'User deleted' });
});

module.exports = { listUsers, getUser, createUser, updateUser, deleteUser };
