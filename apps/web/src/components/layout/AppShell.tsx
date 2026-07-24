import type { CSSProperties, ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/useAuth';
import { AppSidebar, type BusinessViewKey } from './Sidebar';

interface AppShellProps {
  view: BusinessViewKey;
  onViewChange: (view: BusinessViewKey) => void;
  sidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
  children: ReactNode;
}

// Per the design spec: sidebar is 220px expanded, 56px collapsed (icon-only).
const SIDEBAR_WIDTH_VARS = {
  '--sidebar-width': '220px',
  '--sidebar-width-icon': '56px',
} as CSSProperties;

export function AppShell({
  view,
  onViewChange,
  sidebarOpen,
  onSidebarOpenChange,
  children,
}: AppShellProps) {
  const { logout } = useAuth();

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={onSidebarOpenChange}
      style={SIDEBAR_WIDTH_VARS}
    >
      <AppSidebar view={view} onViewChange={onViewChange} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
          <SidebarTrigger />
          <span className="text-sm font-medium text-muted-foreground">Cue Room</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={logout}
            data-testid="logout-button"
          >
            <LogOut />
            Log out
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
