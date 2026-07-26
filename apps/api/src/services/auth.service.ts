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

// Exchanges a valid refresh token for a new access token. The refresh token
// itself is NOT rotated -- reused until its own 30-day expiry.
export async function refreshToken(token: string) {
  const { sub } = verifyRefreshToken(token); // throws -> caller maps to 401
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
