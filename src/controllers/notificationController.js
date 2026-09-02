const asyncHandler = require('express-async-handler');
const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');

// Staff see internal notifications; client-portal logins see only their own.
function scopeFor(user) {
  return user.role === 'Client' ? { client: user.client } : { client: null };
}

// GET /api/notifications
const listNotifications = asyncHandler(async (req, res) => {
  await notificationService.refreshSystemAlerts();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const filter = scopeFor(req.user);
  if (req.query.unread === 'true') filter.read = false;
  if (req.query.category) filter.category = req.query.category;
  const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(limit);
  res.json(notifications);
});

// GET /api/notifications/unread-count
const unreadCount = asyncHandler(async (req, res) => {
  await notificationService.refreshSystemAlerts();
  const count = await Notification.countDocuments({ ...scopeFor(req.user), read: false });
  res.json({ count });
});

// POST /api/notifications/:id/read
const markRead = asyncHandler(async (req, res) => {
  const note = await Notification.findOne({ _id: req.params.id, ...scopeFor(req.user) });
  if (!note) {
    res.status(404);
    throw new Error('Notification not found');
  }
  note.read = true;
  await note.save();
  res.json(note);
});

// POST /api/notifications/read-all
const markAllRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany({ ...scopeFor(req.user), read: false }, { $set: { read: true } });
  res.json({ modified: result.modifiedCount });
});

// DELETE /api/notifications/:id
const removeNotification = asyncHandler(async (req, res) => {
  const note = await Notification.findOne({ _id: req.params.id, ...scopeFor(req.user) });
  if (!note) {
    res.status(404);
    throw new Error('Notification not found');
  }
  await note.deleteOne();
  res.json({ message: 'Notification deleted' });
});

// DELETE /api/notifications  (clear all read)
const clearRead = asyncHandler(async (req, res) => {
  const result = await Notification.deleteMany({ ...scopeFor(req.user), read: true });
  res.json({ deleted: result.deletedCount });
});

module.exports = {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  removeNotification,
  clearRead,
};
