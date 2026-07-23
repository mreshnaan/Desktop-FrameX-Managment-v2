import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../lib/jwt.js';

describe('jwt', () => {
  it('round-trips subject and role through sign/verify', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'CASHIER' });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('CASHIER');
  });

  it('throws on a tampered token', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'CASHIER' });
    expect(() => verifyAccessToken(token + 'x')).toThrow();
  });
});
