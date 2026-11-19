const dotenv = require('dotenv');
const path = require('node:path');

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const baseUrl = (process.env.APP_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

async function main() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be configured in .env.local.');
  }
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  const login = await loginResponse.json();
  if (!loginResponse.ok || !login.token) {
    throw new Error(login.message || 'Automatic prediction login failed.');
  }

  const response = await fetch(`${baseUrl}/api/predictions/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'Prediction orchestration failed.');
  console.log(JSON.stringify(body, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
