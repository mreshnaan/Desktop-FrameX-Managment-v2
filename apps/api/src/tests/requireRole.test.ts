import { describe, it, expect, vi } from 'vitest';
import type { Response, NextFunction } from 'express';
import { requireView } from '../middleware/requireRole';
import type { AuthedRequest } from '../middleware/auth';

// Minimal typed mock shapes instead of `any` -- only the members requireView
// actually touches on req/res.
interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function mockRes(): MockResponse {
  const res = {} as MockResponse;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(role: 'OWNER' | 'ADMIN' | 'CASHIER'): Pick<AuthedRequest, 'user'> {
  return { user: { sub: 'u1', role } };
}

describe('requireView', () => {
  it('allows a cashier into rateManagement (per the agreed permission matrix)', () => {
    const req = mockReq('CASHIER');
    const res = mockRes();
    const next: NextFunction = vi.fn();
    requireView('rateManagement')(req as AuthedRequest, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks a cashier from userManagement', () => {
    const req = mockReq('CASHIER');
    const res = mockRes();
    const next: NextFunction = vi.fn();
    requireView('userManagement')(req as AuthedRequest, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows owner into userManagement', () => {
    const req = mockReq('OWNER');
    const res = mockRes();
    const next: NextFunction = vi.fn();
    requireView('userManagement')(req as AuthedRequest, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
