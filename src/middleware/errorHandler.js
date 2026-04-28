function notFound(req, res, next) {
  res.status(404);
  next(new Error(`Not found: ${req.originalUrl}`));
}

function errorHandler(err, _req, res, _next) {
  let status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  let message = err.message || 'Server error';

  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    status = 400;
    message = 'Invalid id';
  }

  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = field ? `Duplicate value for "${field}"` : 'Duplicate key';
  }

  res.status(status).json({
    message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
}

module.exports = { notFound, errorHandler };
