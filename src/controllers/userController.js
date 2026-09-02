const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const { recordAudit } = require('../middleware/audit');
const { sanitizePermissions, effectivePermissions, ROLE_PRESETS } = require('../config/permissions');

function withPermissions(user) {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  obj.permissions = effectivePermissions(user);
  return obj;
}

// A user's admin actions must never leave the system without an active Administrator.
async function countOtherActiveAdmins(excludeId) {
  return User.countDocuments({
    _id: { $ne: excludeId },
    role: 'Administrator',
    status: 'active',
  });
}

// GET /api/users
const listUsers = asyncHandler(async (_req, res) => {
  const users = await User.find({ role: { $ne: 'Client' } }).sort({ createdAt: -1 });
  res.json(users.map(withPermissions));
});

// GET /api/users/:id
const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  res.json(withPermissions(user));
});

// POST /api/users
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role, status, permissions } = req.body;
  if (role === 'Client') {
    res.status(400);
    throw new Error('Client logins are created from the Clients page');
  }
  if (!name || !email || !password) {
    res.status(400);
    throw new Error('Name, email, and password are required');
  }
  const exists = await User.findOne({ email: email.toLowerCase() });
  if (exists) {
    res.status(409);
    throw new Error('Email already registered');
  }
  const resolvedRole = role || 'Accountant';
  const grid =
    permissions !== undefined
      ? sanitizePermissions(permissions)
      : { ...(ROLE_PRESETS[resolvedRole] || {}) };
  const user = await User.create({
    name,
    email,
    password,
    phone,
    role: resolvedRole,
    status,
    permissions: grid,
  });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Users',
    details: `Added new user: ${user.name} (${user.role})`,
  });
  res.status(201).json(withPermissions(user));
});

// PUT /api/users/:id
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  const { name, email, phone, role, status, password, permissions } = req.body;
  if (role === 'Client') {
    res.status(400);
    throw new Error('Client logins are managed from the Clients page');
  }

  const isSelf = String(user._id) === String(req.user._id);
  if (isSelf && role !== undefined && role !== user.role) {
    res.status(400);
    throw new Error('You cannot change your own role');
  }
  if (isSelf && status !== undefined && status !== user.status) {
    res.status(400);
    throw new Error('You cannot change your own status');
  }

  // Demoting or deactivating an Administrator must leave at least one active admin.
  const losesAdmin =
    user.role === 'Administrator' &&
    ((role !== undefined && role !== 'Administrator') ||
      (status !== undefined && status !== 'active'));
  if (losesAdmin && (await countOtherActiveAdmins(user._id)) === 0) {
    res.status(400);
    throw new Error('At least one active Administrator is required');
  }

  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (phone !== undefined) user.phone = phone;
  if (role !== undefined) user.role = role;
  if (status !== undefined) user.status = status;
  if (password) user.password = password;
  if (permissions !== undefined) {
    user.permissions = sanitizePermissions(permissions);
    user.markModified('permissions');
  }
  await user.save();
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Users',
    details: `Updated user: ${user.name}`,
  });
  res.json(withPermissions(user));
});

// DELETE /api/users/:id
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }
  if (String(user._id) === String(req.user._id)) {
    res.status(400);
    throw new Error('You cannot delete your own account');
  }
  if (user.role === 'Administrator' && (await countOtherActiveAdmins(user._id)) === 0) {
    res.status(400);
    throw new Error('At least one active Administrator is required');
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
