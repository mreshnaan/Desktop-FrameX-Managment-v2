import { useEffect, useState } from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { hasAccess, todayStr } from '@/lib/shared';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { useAuth } from '@/lib/auth/useAuth';
import { startSyncEngine } from '@/lib/sync/syncEngine';
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

// networkMode defaults to 'online' in TanStack Query, which pauses queries
// and mutations whenever the browser is offline -- even ones whose queryFn
// never touches the network (every view here reads/writes local Dexie
// tables). That silently broke the offline-first claim: local writes landed
// in IndexedDB immediately (enqueueOutbox works offline), but the UI never
// re-rendered to show them because the invalidated query stayed "paused"
// until connectivity returned. 'always' makes queries/mutations run
// unconditionally, which is correct for state whose real backing store is
// local-first Dexie, not the network.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

function AuthenticatedApp() {
  const { state } = useAuth();
  const [view, setView] = useState<BusinessViewKey>('dailySales');
  const [date, setDate] = useState(todayStr());
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Defense in depth: the sidebar (Sidebar.tsx) already hides the "User
  // Management" nav button for roles without access, but that alone doesn't
  // stop the view from being reached some other way (e.g. state left over
  // from a role change, a bug elsewhere). The real enforcement is server-side
  // (`requireView` on the API), but this check avoids rendering a confusing
  // blank/broken screen client-side if it's ever reached.
  const role = state.user?.role;

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
      {view === 'userManagement' &&
        (role && hasAccess(role, 'userManagement') ? (
          <UserManagementView />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Not authorized to view this page.
          </div>
        ))}
    </AppShell>
  );
}

function Gate() {
  const { state, refreshAccessToken } = useAuth();

  useEffect(() => {
    if (!state.accessToken) return;
    return startSyncEngine(state.accessToken, queryClient, refreshAccessToken);
    // refreshAccessToken is intentionally omitted from deps: it is redefined
    // every render, and re-keying on it would needlessly tear down/restart the
    // sync engine. The engine only needs the currently-valid closure, which it
    // captures at start time; the token itself is the meaningful dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.accessToken]);

  return state.user ? <AuthenticatedApp /> : <LoginForm />;
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
