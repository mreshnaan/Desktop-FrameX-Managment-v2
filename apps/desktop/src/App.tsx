import { useEffect, useState } from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { hasPermission, todayStr } from '@/lib/shared';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { useAuth } from '@/lib/auth/useAuth';
import { startSyncEngine, runBootstrapPull } from '@/lib/sync/syncEngine';
import { commands } from '@/lib/tauri/commands';
import LoginForm from '@/components/auth/LoginForm';
import { AppShell } from './components/layout/AppShell';
import type { BusinessViewKey } from './components/layout/Sidebar';
import DailySalesView from './components/views/DailySalesView';
import MonthlySalesView from './components/views/MonthlySalesView';
import CustomersView from './components/views/CustomersView';
import CreditManagementView from './components/views/CreditManagementView';
import ExpensesView from './components/views/ExpensesView';
import RateManagementView from './components/views/RateManagementView';
import UserManagementView from './components/views/UserManagementView';
import RoleManagementView from './components/views/RoleManagementView';
import CategoryManagementView from './components/views/CategoryManagementView';
import BackupSettingsView from './components/views/BackupSettingsView';
import CafeView from './components/views/CafeView';
import ProductManagementView from './components/views/ProductManagementView';
import type { PermissionKey } from '@/lib/shared';

// networkMode defaults to 'online' in TanStack Query, which pauses queries
// and mutations whenever the browser is offline -- even ones whose queryFn
// never touches the network (every view here reads/writes local SQLite via
// Tauri commands, not the network). 'always' makes queries/mutations run
// unconditionally, which is correct for state whose real backing store is
// local-first SQLite, not the network. Same rationale as apps/web.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

// Defense in depth: the sidebar (Sidebar.tsx) already hides nav buttons for
// roles without the matching permission, but that alone doesn't stop a view
// from being reached some other way (e.g. state left over from a role
// change, a bug elsewhere). The real enforcement is server-side
// (`requireView` on the API), but this avoids rendering a confusing
// blank/broken screen client-side if it's ever reached.
function PermissionGate({ permissions, requires, children }: {
  permissions: string[] | undefined;
  requires: PermissionKey;
  children: React.ReactNode;
}) {
  if (!permissions || !hasPermission(permissions, requires)) {
    return <div className="p-4 text-sm text-muted-foreground">Not authorized to view this page.</div>;
  }
  return <>{children}</>;
}

function AuthenticatedApp() {
  const { state } = useAuth();
  const [view, setView] = useState<BusinessViewKey>('dailySales');
  const [date, setDate] = useState(todayStr());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const permissions = state.user?.permissions;

  return (
    <AppShell
      view={view}
      onViewChange={setView}
      sidebarOpen={sidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
    >
      {view === 'dailySales' && <DailySalesView date={date} onDateChange={setDate} />}
      {view === 'monthlySales' && (
        <MonthlySalesView
          onJumpToDate={(d) => {
            setDate(d);
            setView('dailySales');
          }}
        />
      )}
      {view === 'customers' && <CustomersView />}
      {view === 'creditManagement' && <CreditManagementView />}
      {view === 'expenses' && <ExpensesView date={date} onDateChange={setDate} />}
      {view === 'rateManagement' && <RateManagementView />}
      {view === 'cafe' && (
        <PermissionGate permissions={permissions} requires="cafe">
          <CafeView />
        </PermissionGate>
      )}
      {view === 'userManagement' && (
        <PermissionGate permissions={permissions} requires="userManagement">
          <UserManagementView />
        </PermissionGate>
      )}
      {view === 'roleManagement' && (
        <PermissionGate permissions={permissions} requires="roleManagement">
          <RoleManagementView />
        </PermissionGate>
      )}
      {view === 'categoryManagement' && (
        <PermissionGate permissions={permissions} requires="categoryManagement">
          <CategoryManagementView />
        </PermissionGate>
      )}
      {view === 'productManagement' && (
        <PermissionGate permissions={permissions} requires="productManagement">
          <ProductManagementView />
        </PermissionGate>
      )}
      {view === 'backupRestore' && (
        <PermissionGate permissions={permissions} requires="backupRestore">
          <BackupSettingsView />
        </PermissionGate>
      )}
    </AppShell>
  );
}

function Gate() {
  const { state, ready, refreshAccessToken } = useAuth();
  // Categories/stations ship empty in a fresh SQLite database (see the
  // desktop design spec) -- a fresh install has nothing to show until it's
  // pulled them from the server at least once. This blocks the app shell
  // until that first pull completes, so the UI never renders with zero
  // categories.
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.accessToken) return;
    return startSyncEngine(state.accessToken, queryClient, refreshAccessToken);
    // refreshAccessToken is intentionally omitted from deps: it is redefined
    // every render, and re-keying on it would needlessly tear down/restart the
    // sync engine. The engine only needs the currently-valid closure, which it
    // captures at start time; the token itself is the meaningful dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken]);

  useEffect(() => {
    if (!state.accessToken || bootstrapped) return;
    let cancelled = false;
    (async () => {
      const existing = await commands.listCategories();
      if (existing.length > 0) {
        if (!cancelled) setBootstrapped(true);
        return;
      }
      try {
        await runBootstrapPull(state.accessToken!);
        if (!cancelled) setBootstrapped(true);
      } catch (e) {
        if (!cancelled) setBootstrapError(e instanceof Error ? e.message : 'Failed to load categories');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.accessToken, bootstrapped]);

  // `ready` is false while AuthContext is still attempting its launch-time
  // silent refresh from the OS keychain -- showing LoginForm too early would
  // flash it for an already-logged-in user before that check resolves.
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!state.user) return <LoginForm />;

  if (!bootstrapped) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-sm text-muted-foreground">
        {bootstrapError ? `Failed to load: ${bootstrapError}` : 'Loading…'}
      </div>
    );
  }

  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </QueryClientProvider>
  );
}
