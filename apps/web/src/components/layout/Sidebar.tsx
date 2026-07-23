import type { ComponentType } from 'react';
import { Calendar, BarChart3, Users, CreditCard, Receipt, Settings } from 'lucide-react';
import type { ViewKey } from '@cue-room/shared';
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
 * The six business views navigable today. 'userManagement' is part of the
 * shared ViewKey union (added for role-gating in a later task) but has no
 * view component yet, so it is excluded here.
 */
export type BusinessViewKey = Exclude<ViewKey, 'userManagement'>;

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
];

interface AppSidebarProps {
  view: BusinessViewKey;
  onViewChange: (view: BusinessViewKey) => void;
}

export function AppSidebar({ view, onViewChange }: AppSidebarProps) {
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
              {NAV_ITEMS.map(item => (
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
