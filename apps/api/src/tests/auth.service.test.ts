import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, refreshToken } from '../services/auth.service';
import { hashPassword } from '../lib/password';
import { signRefreshToken } from '../lib/jwt';
import { prisma } from '../db';

vi.mock('../db', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe('login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tokens for correct credentials', async () => {
    const passwordHash = await hashPassword('correct-horse-battery');
    const now = new Date();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', email: 'owner@cueroom.test', passwordHash, name: 'Owner', role: 'OWNER', createdAt: now, updatedAt: now,
    });
    const result = await login('owner@cueroom.test', 'correct-horse-battery');
    expect(result.accessToken).toBeTypeOf('string');
    expect(result.user.role).toBe('OWNER');
  });

  it('rejects a wrong password', async () => {
    const passwordHash = await hashPassword('correct-horse-battery');
    const now = new Date();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', email: 'owner@cueroom.test', passwordHash, name: 'Owner', role: 'OWNER', createdAt: now, updatedAt: now,
    });
    await expect(login('owner@cueroom.test', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('rejects an unknown email', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(login('nobody@cueroom.test', 'whatever')).rejects.toThrow('Invalid credentials');
  });
});

describe('refreshToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues a fresh access token for a valid refresh token', async () => {
    const now = new Date();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', email: 'owner@cueroom.test', passwordHash: 'x', name: 'Owner', role: 'OWNER', createdAt: now, updatedAt: now,
    });
    const token = signRefreshToken({ sub: 'u1' });

    const result = await refreshToken(token);

    expect(result.accessToken).toBeTypeOf('string');
    expect(result.user).toEqual({ id: 'u1', email: 'owner@cueroom.test', name: 'Owner', role: 'OWNER' });
    // Looked the user up by the subject embedded in the refresh token.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
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
