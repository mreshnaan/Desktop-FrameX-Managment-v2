import { prisma } from '../db';
import { verifyPassword } from '../lib/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import type { Role } from '../shared/index';

export async function login(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error('Invalid credentials');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new Error('Invalid credentials');

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role as Role }),
    refreshToken: signRefreshToken({ sub: user.id }),
    user: { id: user.id, username: user.username, name: user.name, role: user.role as Role },
  };
}

// Exchanges a still-valid refresh token for a freshly minted access token.
// The refresh token itself is NOT rotated -- it is reused until its own 30-day
// expiry (see signRefreshToken). This keeps clients simple (they store the
// refresh token once at login and never have to re-persist it) and is a common,
// acceptable pattern for a single-tenant internal app; the security trade-off
// versus rotation is documented in the task report.
export async function refreshToken(token: string) {
  // Throws on an expired/tampered/malformed refresh token -- the caller maps
  // that to a 401.
  const { sub } = verifyRefreshToken(token);
  // The user could have been deleted since the refresh token was issued.
  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user) throw new Error('Invalid refresh token');

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role as Role }),
    user: { id: user.id, username: user.username, name: user.name, role: user.role as Role },
  };
}
