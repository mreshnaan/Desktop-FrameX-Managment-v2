// Roles are dynamic, DB-backed data (apps/api's Role/Permission tables) --
// this file only carries the static permission-key list, shared with
// apps/api so both sides agree on valid keys. Access checks are
// permission-based against the permission list embedded in the JWT at
// login, not a role-name switch.

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
  | 'auditLog';

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
];

export function hasPermission(permissions: string[], key: PermissionKey): boolean {
  return permissions.includes(key);
}
