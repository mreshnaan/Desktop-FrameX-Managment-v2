export const ROLES = ['OWNER', 'ADMIN', 'CASHIER'] as const;
export type Role = (typeof ROLES)[number];

export type ViewKey =
  | 'dailySales'
  | 'monthlySales'
  | 'customers'
  | 'creditManagement'
  | 'expenses'
  | 'rateManagement'
  | 'userManagement';

const BUSINESS_VIEWS: ViewKey[] = [
  'dailySales', 'monthlySales', 'customers', 'creditManagement', 'expenses', 'rateManagement',
];

export const ROLE_PERMISSIONS: Record<Role, ViewKey[]> = {
  OWNER: [...BUSINESS_VIEWS, 'userManagement'],
  ADMIN: [...BUSINESS_VIEWS, 'userManagement'],
  CASHIER: [...BUSINESS_VIEWS],
};

export function hasAccess(role: Role, view: ViewKey): boolean {
  return ROLE_PERMISSIONS[role].includes(view);
}
