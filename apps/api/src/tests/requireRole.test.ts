import { describe, it, expect, vi } from 'vitest';
import { requireView } from '../middleware/requireRole';

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('requireView', () => {
  it('allows a cashier into rateManagement (per the agreed permission matrix)', () => {
    const req: any = { user: { sub: 'u1', role: 'CASHIER' } };
    const res = mockRes();
    const next = vi.fn();
    requireView('rateManagement')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks a cashier from userManagement', () => {
    const req: any = { user: { sub: 'u1', role: 'CASHIER' } };
    const res = mockRes();
    const next = vi.fn();
    requireView('userManagement')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows owner into userManagement', () => {
    const req: any = { user: { sub: 'u1', role: 'OWNER' } };
    const res = mockRes();
    const next = vi.fn();
    requireView('userManagement')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
