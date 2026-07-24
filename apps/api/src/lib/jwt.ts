import jwt from 'jsonwebtoken';
import { env } from '../env';

export interface AccessTokenPayload {
  sub: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: { sub: string }): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
}
