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
import MonthlyExpensesView from './components/views/MonthlyExpensesView';
import RateManagementView from './components/views/RateManagementView';
import UserManagementView from './components/views/UserManagementView';
import RoleManagementView from './components/views/RoleManagementView';
import CategoryManagementView from './components/views/CategoryManagementView';
import BackupSettingsView from './components/views/BackupSettingsView';
import CafeView from './components/views/CafeView';
import ProductManagementView from './components/views/ProductManagementView';
import AuditLogView from './components/views/AuditLogView';
import type { PermissionKey } from '@/lib/shared';

// 'always': every query/mutation here hits local SQLite via Tauri, not the
// network, so TanStack Query's default offline-pausing doesn't apply.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

// Defense in depth -- Sidebar already hides nav buttons per permission;
// real enforcement is server-side (`requireView`), this just avoids a
// blank/broken screen if a view is reached some other way.
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
      {view === 'monthlyExpenses' && (
        <MonthlyExpensesView
          onJumpToDate={(d) => {
            setDate(d);
            setView('expenses');
          }}
        />
      )}
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
      {view === 'auditLog' && (
        <PermissionGate permissions={permissions} requires="auditLog">
          <AuditLogView />
        </PermissionGate>
      )}
    </AppShell>
  );
}

function Gate() {
  const { state, ready, refreshAccessToken } = useAuth();
  // A fresh SQLite install has no categories/stations until first pulled
  // from the server -- blocks the app shell until that pull completes.
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  useEffect(() => {
    if (!state.accessToken) return;
    return startSyncEngine(state.accessToken, queryClient, refreshAccessToken);
    // refreshAccessToken is redefined every render; omitted so it doesn't
    // needlessly restart the sync engine.
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

  // `ready` false = still attempting silent refresh from the OS keychain --
  // avoids flashing LoginForm for an already-logged-in user.
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
