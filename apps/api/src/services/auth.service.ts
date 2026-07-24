import { prisma } from '../db';
import { verifyPassword } from '../lib/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';

const roleInclude = { role: { include: { permissions: { include: { permission: true } } } } } as const;

function toPublicUser(user: {
  id: string;
  username: string;
  name: string;
  role: { id: string; name: string; permissions: { permission: { key: string } }[] };
}) {
  const permissions = user.role.permissions.map((rp) => rp.permission.key);
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: { id: user.role.id, name: user.role.name },
    permissions,
  };
}

export async function login(username: string, pin: string) {
  const user = await prisma.user.findUnique({ where: { username }, include: roleInclude });
  if (!user) throw new Error('Invalid credentials');
  const ok = await verifyPassword(pin, user.pinHash);
  if (!ok) throw new Error('Invalid credentials');

  const publicUser = toPublicUser(user);
  return {
    accessToken: signAccessToken({
      sub: user.id,
      roleId: publicUser.role.id,
      roleName: publicUser.role.name,
      permissions: publicUser.permissions,
    }),
    refreshToken: signRefreshToken({ sub: user.id }),
    user: publicUser,
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
  const user = await prisma.user.findUnique({ where: { id: sub }, include: roleInclude });
  if (!user) throw new Error('Invalid refresh token');

  const publicUser = toPublicUser(user);
  return {
    accessToken: signAccessToken({
      sub: user.id,
      roleId: publicUser.role.id,
      roleName: publicUser.role.name,
      permissions: publicUser.permissions,
    }),
    user: publicUser,
  };
}
