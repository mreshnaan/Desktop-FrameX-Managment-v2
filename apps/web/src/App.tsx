import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayStr } from '@/lib/shared';
import { AppShell } from './components/layout/AppShell';
import type { BusinessViewKey } from './components/layout/Sidebar';
import DailySalesView from './components/views/DailySalesView';
import MonthlySalesView from './components/views/MonthlySalesView';
import CustomersView from './components/views/CustomersView';
import CreditManagementView from './components/views/CreditManagementView';
import ExpensesView from './components/views/ExpensesView';
import RateManagementView from './components/views/RateManagementView';

const queryClient = new QueryClient();

export default function App() {
  const [view, setView] = useState<BusinessViewKey>('dailySales');
  const [date, setDate] = useState(todayStr());
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <QueryClientProvider client={queryClient}>
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
      </AppShell>
    </QueryClientProvider>
  );
}
