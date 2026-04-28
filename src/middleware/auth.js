const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');

const protect = asyncHandler(async (req, res, next) => {
  let token;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  }

  if (!token) {
    res.status(401);
    throw new Error('Not authorized, no token');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    res.status(401);
    throw new Error('Not authorized, token invalid');
  }

  const user = await User.findById(decoded.id).select('-password');
  if (!user) {
    res.status(401);
    throw new Error('Not authorized, user not found');
  }
  if (user.status !== 'active') {
    res.status(403);
    throw new Error('Account is inactive');
  }

  req.user = user;
  next();
});

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    res.status(401);
    return next(new Error('Not authorized'));
  }
  if (roles.length && !roles.includes(req.user.role)) {
    res.status(403);
    return next(new Error(`Role "${req.user.role}" is not allowed for this resource`));
  }
  next();
};

module.exports = { protect, authorize };
