import { useState } from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { hasPermission, todayStr } from '@/lib/shared';
import { AuthProvider } from '@/lib/auth/AuthContext';
import { useAuth } from '@/lib/auth/useAuth';
import LoginForm from '@/components/auth/LoginForm';
import { AppShell } from './components/layout/AppShell';
import type { BusinessViewKey } from './components/layout/Sidebar';
import DailySalesView from './components/views/DailySalesView';
import MonthlySalesView from './components/views/MonthlySalesView';
import CustomersView from './components/views/CustomersView';
import CreditManagementView from './components/views/CreditManagementView';
import ExpensesView from './components/views/ExpensesView';
import RateManagementView from './components/views/RateManagementView';
import OfferManagementView from './components/views/OfferManagementView';
import UserManagementView from './components/views/UserManagementView';
import AuditLogView from './components/views/AuditLogView';
import CafeView from './components/views/CafeView';

// Every view here is a thin read-only fetch of /sync/pull (see usePullData) --
// no local storage, no offline-first concerns, so TanStack Query's default
// 'online' networkMode (pause queries while offline) is exactly right.
const queryClient = new QueryClient();

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
      {view === 'offerManagement' &&
        (permissions && hasPermission(permissions, 'offerManagement') ? (
          <OfferManagementView />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Not authorized to view this page.
          </div>
        ))}
      {view === 'cafe' &&
        (permissions && hasPermission(permissions, 'cafe') ? (
          <CafeView />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Not authorized to view this page.
          </div>
        ))}
      {view === 'userManagement' &&
        (permissions && hasPermission(permissions, 'userManagement') ? (
          <UserManagementView />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Not authorized to view this page.
          </div>
        ))}
      {view === 'auditLog' &&
        (permissions && hasPermission(permissions, 'auditLog') ? (
          <AuditLogView />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            Not authorized to view this page.
          </div>
        ))}
    </AppShell>
  );
}

function Gate() {
  const { state } = useAuth();

  if (!state.user) return <LoginForm />;

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
