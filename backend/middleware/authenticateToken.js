const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return res.status(401).json({ message: 'A bearer token is required.' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET is not configured.');
    return res.status(503).json({ message: 'Authentication is not configured.' });
  }

  try {
    req.user = jwt.verify(match[1], secret);
    return next();
  } catch {
    return res.status(401).json({ message: 'Token is invalid or expired.' });
  }
}

module.exports = authenticateToken;
