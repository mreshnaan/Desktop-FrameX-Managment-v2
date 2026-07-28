// Roles are dynamic, DB-backed data -- this file only carries the static
// permission-key list, kept in sync with apps/api's copy.

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

export function hasPermission(permissions: string[], key: PermissionKey): boolean {
  return permissions.includes(key);
}
