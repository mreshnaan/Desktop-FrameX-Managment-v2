import type { ComponentType } from 'react';
import { Calendar, BarChart3, Users, CreditCard, Receipt, Settings, ShieldCheck } from 'lucide-react';
import { hasAccess, type ViewKey } from '@/lib/shared';
import { useAuth } from '@/lib/auth/useAuth';
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
 * All seven views navigable today, including 'userManagement' (Task 22).
 * Kept as a distinct alias (rather than importing ViewKey directly at every
 * call site) so downstream consumers (AppShell, App.tsx) don't need to know
 * this is the full shared ViewKey union.
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
  { key: 'userManagement', label: 'User Management', icon: ShieldCheck },
];

interface AppSidebarProps {
  view: BusinessViewKey;
  onViewChange: (view: BusinessViewKey) => void;
}

export function AppSidebar({ view, onViewChange }: AppSidebarProps) {
  const { state } = useAuth();
  const role = state.user?.role;
  const visibleItems = role ? NAV_ITEMS.filter(item => hasAccess(role, item.key)) : [];

  return (
    <SidebarPrimitive collapsible="icon">
      <SidebarHeader>
        <div className="truncate px-2 py-1 text-lg font-semibold group-data-[collapsible=icon]:hidden">
          Cue Room
        </div>
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
