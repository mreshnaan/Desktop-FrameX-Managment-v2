import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../lib/jwt';

describe('jwt', () => {
  it('round-trips subject, role, and permissions through sign/verify', () => {
    const token = signAccessToken({ sub: 'user-1', roleId: 'r1', roleName: 'CASHIER', permissions: ['dailySales'] });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.roleName).toBe('CASHIER');
    expect(decoded.permissions).toEqual(['dailySales']);
  });

  it('throws on a tampered token', () => {
    const token = signAccessToken({ sub: 'user-1', roleId: 'r1', roleName: 'CASHIER', permissions: [] });
    expect(() => verifyAccessToken(token + 'x')).toThrow();
  });
});
