const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

async function login(req, res) {
  const body = req.body;
  const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body && typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return res.status(400).json({ message: 'email and password are required.' });
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'email must be a valid email address.' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ message: 'password must be at most 72 bytes.' });
  }

  const [rows] = await pool.execute(
    `SELECT id, name, email, password, role
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET is not configured.');
    return res.status(503).json({ message: 'Authentication is not configured.' });
  }

  const token = jwt.sign(
    { sub: String(user.id), role: user.role },
    secret,
    { expiresIn: '8h' },
  );
  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}

module.exports = { login };
