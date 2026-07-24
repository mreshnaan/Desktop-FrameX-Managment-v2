// Roles are now dynamic, DB-backed data (see the Role/Permission/RolePermission
// Prisma models) rather than a fixed enum -- this file only carries the
// static list of valid permission keys, used both to seed the three
// protected system roles (OWNER/ADMIN/CASHIER) and to render the
// role-creation checkbox UI. Access checks are permission-based
// (hasPermission(permissions, key)) against the permission list embedded in
// the JWT at login, not a role-name switch.

export type PermissionKey =
  | 'dailySales'
  | 'monthlySales'
  | 'customers'
  | 'creditManagement'
  | 'expenses'
  | 'rateManagement'
  | 'userManagement'
  | 'roleManagement'
  | 'categoryManagement'
  | 'backupRestore';

export const PERMISSION_KEYS: { key: PermissionKey; label: string }[] = [
  { key: 'dailySales', label: 'Daily Sales' },
  { key: 'monthlySales', label: 'Monthly Sales' },
  { key: 'customers', label: 'Customers' },
  { key: 'creditManagement', label: 'Credit Management' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'rateManagement', label: 'Rate Management' },
  { key: 'userManagement', label: 'User Management' },
  { key: 'roleManagement', label: 'Role Management' },
  { key: 'categoryManagement', label: 'Category & Station Management' },
  { key: 'backupRestore', label: 'Backup & Restore' },
];

const BUSINESS_PERMISSIONS: PermissionKey[] = [
  'dailySales', 'monthlySales', 'customers', 'creditManagement', 'expenses', 'rateManagement',
];
const ADMIN_ONLY_PERMISSIONS: PermissionKey[] = [
  'userManagement', 'roleManagement', 'categoryManagement', 'backupRestore',
];

// Seed data for the three protected system roles -- only used by
// apps/api/prisma/seed.ts, and by nothing else at runtime (custom roles'
// permission sets are read from the database, not this constant).
export const SYSTEM_ROLE_SEED: { name: string; permissions: PermissionKey[] }[] = [
  { name: 'OWNER', permissions: [...BUSINESS_PERMISSIONS, ...ADMIN_ONLY_PERMISSIONS] },
  { name: 'ADMIN', permissions: [...BUSINESS_PERMISSIONS, ...ADMIN_ONLY_PERMISSIONS] },
  { name: 'CASHIER', permissions: [...BUSINESS_PERMISSIONS] },
];

export function hasPermission(permissions: string[], key: PermissionKey): boolean {
  return permissions.includes(key);
}
