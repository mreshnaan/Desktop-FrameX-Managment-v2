import { prisma } from '../db';
import { verifyPassword } from '../lib/password';
import { signAccessToken, signRefreshToken } from '../lib/jwt';
import type { Role } from '../shared/index';

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
