import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login } from '../services/auth.service';
import { hashPassword } from '../lib/password';
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
