import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { withApiErrors, errorResponse } from '@/lib/api-errors';
import { pool } from '@/lib/db';
import '@/lib/env';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const body: unknown = await request.json();
    const values = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const email = typeof values.email === 'string' ? values.email.trim().toLowerCase() : '';
    const password = typeof values.password === 'string' ? values.password : '';

    if (!email || !password) {
      return errorResponse('email and password are required.', 400);
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorResponse('email must be a valid email address.', 400);
    }
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return errorResponse('password must be at most 72 bytes.', 400);
    }

    const [rows] = await pool.execute(
      `SELECT id, name, email, password, role
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email],
    );
    const user = (rows as Array<{
      id: number;
      name: string;
      email: string;
      password: string;
      role: string;
    }>)[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return errorResponse('Invalid email or password.', 401);
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET is not configured.');
      return errorResponse('Authentication is not configured.', 503);
    }

    const token = jwt.sign(
      { sub: String(user.id), role: user.role },
      secret,
      { expiresIn: '8h' },
    );
    return Response.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });
}
