import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import { usePullData } from './usePullData';

export interface CustomerHistoryRow {
  id: string;
  date: string;
  label: string;
  amount: number;
  direction: 'charge' | 'payment';
}

// Read-only: Web displays customer credit balances from /reports/customer-balances.
// The endpoint returns a plain { customerId: balance } object — the frontend
// does ZERO computation. balanceFor is a direct property lookup.
export function useCustomers() {
  const { state } = useAuth();
  const pullQuery = usePullData();

  const customers = (pullQuery.data?.customers ?? []).filter(c => !c.deletedAt);

  // Backend returns Record<string, number> — a plain {id: balance} object.
  // No .map(), no .reduce(), no .filter() ever runs in the browser.
  const balancesQuery = useQuery({
    queryKey: ['customer-balances'],
    queryFn: () =>
      apiFetch<Record<string, number>>('/reports/customer-balances', {
        accessToken: state.accessToken,
      }),
    enabled: !!state.accessToken,
  });

  const balances: Record<string, number> = balancesQuery.data ?? {};

  function balanceFor(customerId: string): number {
    return balances[customerId] ?? 0;
  }

  return {
    customers,
    balanceFor,
    isLoading: pullQuery.isLoading || balancesQuery.isLoading,
  };
}

// Separate hook: only fetched when the user expands the history panel
// for a specific customer. Scoped to one customer_id — no full scan.
export function useCustomerCreditHistory(customerId: string, enabled: boolean) {
  const { state } = useAuth();

  return useQuery({
    queryKey: ['customer-credit-history', customerId],
    queryFn: () =>
      apiFetch<CustomerHistoryRow[]>(`/reports/customer-credit-history/${customerId}`, {
        accessToken: state.accessToken,
      }),
    enabled: enabled && !!state.accessToken,
  });
}
