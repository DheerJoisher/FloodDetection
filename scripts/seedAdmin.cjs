const bcrypt = require('bcryptjs');
const pool = require('./db.cjs');

async function seedAdmin() {
  let connection;
  let lockAcquired = false;
  try {
    connection = await pool.getConnection();
    const [lockRows] = await connection.execute(
      'SELECT GET_LOCK(?, 10) AS acquired',
      ['godavari_flood_seed_admin'],
    );
    if (Number(lockRows[0].acquired) !== 1) {
      throw new Error('Could not acquire the admin seed lock; try again.');
    }
    lockAcquired = true;

    const [adminRows] = await connection.execute(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
    );
    if (adminRows.length > 0) {
      console.log('An admin account already exists; no account was created.');
      return;
    }

    const email = typeof process.env.ADMIN_EMAIL === 'string'
      ? process.env.ADMIN_EMAIL.trim().toLowerCase()
      : '';
    const password = process.env.ADMIN_PASSWORD || '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new Error('Set a valid ADMIN_EMAIL in .env.local before seeding the first admin.');
    }
    const passwordLength = Buffer.byteLength(password, 'utf8');
    if (passwordLength < 12 || passwordLength > 72) {
      throw new Error('Set ADMIN_PASSWORD in .env.local to a 12-72 byte password before seeding.');
    }

    const [existingEmailRows] = await connection.execute(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    if (existingEmailRows.length > 0) {
      throw new Error('ADMIN_EMAIL already belongs to a non-admin user; choose another email.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const name = email.split('@')[0].slice(0, 100) || 'Admin';
    await connection.execute(
      `INSERT INTO users (name, email, password, role)
       VALUES (?, ?, ?, 'admin')`,
      [name, email, passwordHash],
    );
    console.log(`Created the initial admin account for ${email}.`);
  } finally {
    try {
      if (lockAcquired) {
        await connection.execute('SELECT RELEASE_LOCK(?)', ['godavari_flood_seed_admin']);
      }
    } finally {
      if (connection) connection.release();
      await pool.end();
    }
  }
}

seedAdmin().catch((error) => {
  console.error('Admin seed failed:', error.message);
  process.exitCode = 1;
});
