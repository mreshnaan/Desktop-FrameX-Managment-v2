import type { ComponentType } from 'react';
import {
  Calendar,
  BarChart3,
  Users,
  CreditCard,
  Receipt,
  Settings,
  ShieldCheck,
  KeyRound,
  LayoutGrid,
  DatabaseBackup,
  Coffee,
  Package,
  History,
} from 'lucide-react';
import { hasPermission, type PermissionKey as ViewKey } from '@/lib/shared';
import { useAuth } from '@/lib/auth/useAuth';
import { Logo } from '@/components/branding/Logo';
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

/**
 * Every navigable view, business and admin alike. Kept as a distinct alias
 * (rather than importing ViewKey directly at every call site) so downstream
 * consumers (AppShell, App.tsx) don't need to know this is the full shared
 * PermissionKey union.
 */
export type BusinessViewKey = ViewKey;

interface NavItem {
  key: BusinessViewKey;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dailySales', label: 'Daily Sales', icon: Calendar },
  { key: 'monthlySales', label: 'Monthly Sales', icon: BarChart3 },
  { key: 'customers', label: 'Customers', icon: Users },
  { key: 'creditManagement', label: 'Credit Management', icon: CreditCard },
  { key: 'expenses', label: 'Expenses', icon: Receipt },
  { key: 'rateManagement', label: 'Rate Management', icon: Settings },
  { key: 'cafe', label: 'Cafe', icon: Coffee },
  { key: 'userManagement', label: 'User Management', icon: ShieldCheck },
  { key: 'roleManagement', label: 'Roles', icon: KeyRound },
  { key: 'categoryManagement', label: 'Categories & Stations', icon: LayoutGrid },
  { key: 'productManagement', label: 'Products & Stock', icon: Package },
  { key: 'backupRestore', label: 'Backup & Restore', icon: DatabaseBackup },
  { key: 'auditLog', label: 'Activity & Sync Logs', icon: History },
];

interface AppSidebarProps {
  view: BusinessViewKey;
  onViewChange: (view: BusinessViewKey) => void;
}

export function AppSidebar({ view, onViewChange }: AppSidebarProps) {
  const { state } = useAuth();
  const permissions = state.user?.permissions;
  const visibleItems = permissions ? NAV_ITEMS.filter(item => hasPermission(permissions, item.key)) : [];

  return (
    <SidebarPrimitive collapsible="icon">
      <SidebarHeader>
        <Logo className="px-2 py-1" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map(item => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    isActive={view === item.key}
                    tooltip={item.label}
                    onClick={() => onViewChange(item.key)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </SidebarPrimitive>
  );
}
