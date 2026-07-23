import { describe, it, expect } from 'vitest';
import { hasAccess } from '../constants/roles';

describe('hasAccess', () => {
  it('grants owner and admin every view including user management', () => {
    expect(hasAccess('OWNER', 'userManagement')).toBe(true);
    expect(hasAccess('ADMIN', 'userManagement')).toBe(true);
    expect(hasAccess('OWNER', 'rateManagement')).toBe(true);
  });

  it('grants cashier every business view but not user management', () => {
    expect(hasAccess('CASHIER', 'dailySales')).toBe(true);
    expect(hasAccess('CASHIER', 'rateManagement')).toBe(true);
    expect(hasAccess('CASHIER', 'creditManagement')).toBe(true);
    expect(hasAccess('CASHIER', 'userManagement')).toBe(false);
  });
});
