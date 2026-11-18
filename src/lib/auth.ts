import 'server-only';

import jwt, { type JwtPayload } from 'jsonwebtoken';

import './env';

export interface AuthClaims extends JwtPayload {
  sub: string;
  role: string;
}

export function verifyBearerToken(request: Request): AuthClaims | Response {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    return Response.json({ message: 'A bearer token is required.' }, { status: 401 });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET is not configured.');
    return Response.json(
      { message: 'Authentication is not configured.' },
      { status: 503 },
    );
  }

  try {
    const claims = jwt.verify(match[1], secret);
    if (
      typeof claims === 'string' ||
      typeof claims.sub !== 'string' ||
      typeof claims.role !== 'string'
    ) {
      return Response.json(
        { message: 'Token is invalid or expired.' },
        { status: 401 },
      );
    }
    return claims as AuthClaims;
  } catch {
    return Response.json(
      { message: 'Token is invalid or expired.' },
      { status: 401 },
    );
  }
}
