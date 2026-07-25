import { useMemo } from 'react';
import { calcCustomerBalance } from '@/lib/shared';
import { usePullData } from './usePullData';

// Read-only: customer/credit management (adding customers, giving credit,
// recording payments) is a desktop-only workflow now -- web only displays
// the resulting balances and history.
export function useCustomers() {
  const query = usePullData();

  const customers = useMemo(
    () => (query.data?.customers ?? []).filter(c => !c.deletedAt),
    [query.data],
  );
  const sessions = useMemo(
    () => (query.data?.sessions ?? []).filter(s => !s.deletedAt),
    [query.data],
  );
  const history = query.data?.creditEntries ?? [];

  function balanceFor(customerId: string): number {
    return calcCustomerBalance(sessions, history, customerId);
  }

  return { customers, history, sessions, isLoading: query.isLoading, balanceFor };
}
