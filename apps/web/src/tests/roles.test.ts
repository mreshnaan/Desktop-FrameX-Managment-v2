import { describe, it, expect } from 'vitest';
import { hasPermission } from '@/lib/shared';

describe('hasPermission', () => {
  it('grants access when the permission key is present in the list', () => {
    const ownerPermissions = ['dailySales', 'rateManagement', 'userManagement', 'roleManagement'];
    expect(hasPermission(ownerPermissions, 'userManagement')).toBe(true);
    expect(hasPermission(ownerPermissions, 'rateManagement')).toBe(true);
  });

  it('denies access when the permission key is absent', () => {
    const cashierPermissions = ['dailySales', 'rateManagement', 'creditManagement'];
    expect(hasPermission(cashierPermissions, 'dailySales')).toBe(true);
    expect(hasPermission(cashierPermissions, 'creditManagement')).toBe(true);
    expect(hasPermission(cashierPermissions, 'userManagement')).toBe(false);
  });
});
