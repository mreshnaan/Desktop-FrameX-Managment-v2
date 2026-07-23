import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login } from '../services/auth.service.js';
import { hashPassword } from '../lib/password.js';
import { prisma } from '../db.js';

vi.mock('../db.js', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

describe('login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tokens for correct credentials', async () => {
    const passwordHash = await hashPassword('correct-horse-battery');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1', email: 'owner@cueroom.test', passwordHash, name: 'Owner', role: 'OWNER',
    });
    const result = await login('owner@cueroom.test', 'correct-horse-battery');
    expect(result.accessToken).toBeTypeOf('string');
    expect(result.user.role).toBe('OWNER');
  });

  it('rejects a wrong password', async () => {
    const passwordHash = await hashPassword('correct-horse-battery');
    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1', email: 'owner@cueroom.test', passwordHash, name: 'Owner', role: 'OWNER',
    });
    await expect(login('owner@cueroom.test', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('rejects an unknown email', async () => {
    (prisma.user.findUnique as any).mockResolvedValue(null);
    await expect(login('nobody@cueroom.test', 'whatever')).rejects.toThrow('Invalid credentials');
  });
});
