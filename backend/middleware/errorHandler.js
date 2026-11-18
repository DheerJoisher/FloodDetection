function errorHandler(error, req, res, next) {
  console.error(error);
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body must contain valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large.' });
  }

  return res.status(500).json({ message: 'An unexpected server error occurred.' });
}

module.exports = errorHandler;
