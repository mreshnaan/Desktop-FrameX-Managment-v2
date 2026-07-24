import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, refreshToken } from '../services/auth.service';
import { hashPassword } from '../lib/password';
import { signRefreshToken } from '../lib/jwt';
import { prisma } from '../db';

vi.mock('../db', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

function mockOwnerRow(pinHash: string) {
  const now = new Date();
  return {
    id: 'u1',
    username: 'owner',
    pinHash,
    name: 'Owner',
    roleId: 'role-owner',
    createdAt: now,
    updatedAt: now,
    role: {
      id: 'role-owner',
      name: 'OWNER',
      permissions: [
        { permission: { key: 'dailySales' } },
        { permission: { key: 'userManagement' } },
        { permission: { key: 'roleManagement' } },
      ],
    },
  };
}

describe('login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tokens and the permission list for a correct PIN', async () => {
    const pinHash = await hashPassword('4242');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwnerRow(pinHash));

    const result = await login('owner', '4242');

    expect(result.accessToken).toBeTypeOf('string');
    expect(result.user.role).toEqual({ id: 'role-owner', name: 'OWNER' });
    expect(result.user.permissions).toEqual(['dailySales', 'userManagement', 'roleManagement']);
  });

  it('rejects a wrong PIN', async () => {
    const pinHash = await hashPassword('4242');
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwnerRow(pinHash));
    await expect(login('owner', '0000')).rejects.toThrow('Invalid credentials');
  });

  it('rejects an unknown username', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(login('nobody', '1234')).rejects.toThrow('Invalid credentials');
  });
});

describe('refreshToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues a fresh access token for a valid refresh token', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockOwnerRow('x'));
    const token = signRefreshToken({ sub: 'u1' });

    const result = await refreshToken(token);

    expect(result.accessToken).toBeTypeOf('string');
    expect(result.user).toEqual({
      id: 'u1',
      username: 'owner',
      name: 'Owner',
      role: { id: 'role-owner', name: 'OWNER' },
      permissions: ['dailySales', 'userManagement', 'roleManagement'],
    });
    // Looked the user up by the subject embedded in the refresh token.
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
  });

  it('throws on an invalid/tampered refresh token (never touches the db)', async () => {
    const token = signRefreshToken({ sub: 'u1' });
    await expect(refreshToken(token + 'tampered')).rejects.toThrow();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws when the user no longer exists', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const token = signRefreshToken({ sub: 'deleted-user' });
    await expect(refreshToken(token)).rejects.toThrow('Invalid refresh token');
  });
});
