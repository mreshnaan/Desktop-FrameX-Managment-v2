import { describe, it, expect, vi } from 'vitest';
import type { Response, NextFunction } from 'express';
import { requireView } from '../middleware/requireRole';
import type { AuthedRequest } from '../middleware/auth';

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

function mockReq(permissions: string[]): Pick<AuthedRequest, 'user'> {
  return { user: { sub: 'u1', roleId: 'r1', roleName: 'TEST', permissions } };
}

describe('requireView', () => {
  it('allows access when the permission key is present', () => {
    const req = mockReq(['dailySales', 'rateManagement']);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    requireView('rateManagement')(req as AuthedRequest, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks access when the permission key is absent', () => {
    const req = mockReq(['dailySales', 'rateManagement']);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    requireView('userManagement')(req as AuthedRequest, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows access when the permission is present alongside others', () => {
    const req = mockReq(['dailySales', 'userManagement', 'roleManagement']);
    const res = mockRes();
    const next: NextFunction = vi.fn();
    requireView('userManagement')(req as AuthedRequest, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
