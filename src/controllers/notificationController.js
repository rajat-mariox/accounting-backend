const asyncHandler = require('express-async-handler');
const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');

// GET /api/notifications
const listNotifications = asyncHandler(async (req, res) => {
  await notificationService.refreshSystemAlerts();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const filter = {};
  if (req.query.unread === 'true') filter.read = false;
  if (req.query.category) filter.category = req.query.category;
  const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(limit);
  res.json(notifications);
});

// GET /api/notifications/unread-count
const unreadCount = asyncHandler(async (_req, res) => {
  await notificationService.refreshSystemAlerts();
  const count = await Notification.countDocuments({ read: false });
  res.json({ count });
});

// POST /api/notifications/:id/read
const markRead = asyncHandler(async (req, res) => {
  const note = await Notification.findById(req.params.id);
  if (!note) {
    res.status(404);
    throw new Error('Notification not found');
  }
  note.read = true;
  await note.save();
  res.json(note);
});

// POST /api/notifications/read-all
const markAllRead = asyncHandler(async (_req, res) => {
  const result = await Notification.updateMany({ read: false }, { $set: { read: true } });
  res.json({ modified: result.modifiedCount });
});

// DELETE /api/notifications/:id
const removeNotification = asyncHandler(async (req, res) => {
  const note = await Notification.findById(req.params.id);
  if (!note) {
    res.status(404);
    throw new Error('Notification not found');
  }
  await note.deleteOne();
  res.json({ message: 'Notification deleted' });
});

// DELETE /api/notifications  (clear all read)
const clearRead = asyncHandler(async (_req, res) => {
  const result = await Notification.deleteMany({ read: true });
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
