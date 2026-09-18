function notFound(req, res, next) {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
}

function errorHandler(err, req, res, next) {
  // Mongoose throws these for malformed ids / failed schema validation — both are
  // client mistakes, not server failures, so they should never surface as 500s.
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid ${err.path}: "${err.value}"` });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message });
  }

  const status = res.statusCode !== 200 ? res.statusCode : 500;
  res.status(status).json({
    message: err.message || 'Server error',
  });
}

module.exports = { notFound, errorHandler };
