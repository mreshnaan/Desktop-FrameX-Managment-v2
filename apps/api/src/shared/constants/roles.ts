// Roles are dynamic, DB-backed data -- this file only carries the static
// list of valid permission keys, used to seed the system roles and render
// the role-creation checkbox UI. Access checks are permission-based.

export type PermissionKey =
  | 'dailySales'
  | 'monthlySales'
  | 'customers'
  | 'creditManagement'
  | 'expenses'
  | 'monthlyExpenses'
  | 'rateManagement'
  | 'userManagement'
  | 'roleManagement'
  | 'categoryManagement'
  | 'backupRestore'
  | 'cafe'
  | 'productManagement'
  | 'auditLog'
  | 'offerManagement';

export const PERMISSION_KEYS: { key: PermissionKey; label: string }[] = [
  { key: 'dailySales', label: 'Daily Sales' },
  { key: 'monthlySales', label: 'Monthly Sales' },
  { key: 'customers', label: 'Customers' },
  { key: 'creditManagement', label: 'Credit Management' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'monthlyExpenses', label: 'Monthly Expenses' },
  { key: 'rateManagement', label: 'Rate Management' },
  { key: 'cafe', label: 'Cafe' },
  { key: 'userManagement', label: 'User Management' },
  { key: 'roleManagement', label: 'Role Management' },
  { key: 'categoryManagement', label: 'Category & Station Management' },
  { key: 'productManagement', label: 'Product & Stock Management' },
  { key: 'backupRestore', label: 'Backup & Restore' },
  { key: 'auditLog', label: 'Activity & Sync Logs' },
  { key: 'offerManagement', label: 'Offer Management' },
];

// 'cafe' is business-level (cashiers ring up sales); 'productManagement' and
// 'auditLog' are admin-only, same tier as categoryManagement/userManagement.
const BUSINESS_PERMISSIONS: PermissionKey[] = [
  'dailySales', 'monthlySales', 'customers', 'creditManagement', 'expenses', 'monthlyExpenses', 'rateManagement', 'cafe',
];
const ADMIN_ONLY_PERMISSIONS: PermissionKey[] = [
  'userManagement', 'roleManagement', 'categoryManagement', 'productManagement', 'backupRestore', 'auditLog', 'offerManagement',
];

// Seed data for the three protected system roles -- custom roles' permission
// sets are read from the database, not this constant.
export const SYSTEM_ROLE_SEED: { name: string; permissions: PermissionKey[] }[] = [
  { name: 'OWNER', permissions: [...BUSINESS_PERMISSIONS, ...ADMIN_ONLY_PERMISSIONS] },
  { name: 'ADMIN', permissions: [...BUSINESS_PERMISSIONS, ...ADMIN_ONLY_PERMISSIONS] },
  { name: 'CASHIER', permissions: [...BUSINESS_PERMISSIONS] },
];

export function hasPermission(permissions: string[], key: PermissionKey): boolean {
  return permissions.includes(key);
}
