import { prisma } from '../db.js';
import { verifyPassword } from '../lib/password.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';
import type { Role } from '@prisma/client';

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('Invalid credentials');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error('Invalid credentials');

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role as Role }),
    refreshToken: signRefreshToken({ sub: user.id }),
    user: { id: user.id, email: user.email, name: user.name, role: user.role as Role },
  };
}
