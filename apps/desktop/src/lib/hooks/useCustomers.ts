import { useQuery } from '@tanstack/react-query';
import { commands, type CustomerHistoryRow } from '../tauri/commands';
import { useInvalidateAfter } from './useInvalidateAfter';

// Balances are pre-aggregated in SQLite via get_customer_balances --
// balanceFor is just a direct property lookup, no client-side computation.
export function useCustomers() {
  const invalidateCustomers = useInvalidateAfter([['customers'], ['customer-balances']]);
  const invalidateCreditEntries = useInvalidateAfter([['credit-entries'], ['customer-balances']]);

  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: () => commands.listCustomers(),
  });

  const balancesQuery = useQuery({
    queryKey: ['customer-balances'],
    queryFn: () => commands.getCustomerBalances(),
  });

  const historyQuery = useQuery({
    queryKey: ['credit-entries'],
    queryFn: () => commands.listCreditEntries(),
  });

  async function addCustomer(input: { name: string; phone?: string }) {
    await invalidateCustomers(() => commands.createCustomer(input.name, input.phone ?? ''));
  }

  async function deleteCustomer(id: string) {
    await invalidateCustomers(() => commands.deleteCustomer(id));
  }

  async function adjustCustomer(
    customerId: string,
    date: string,
    type: 'CREDIT_GIVEN' | 'PAYMENT_RECEIVED',
    amount: number,
  ) {
    await invalidateCreditEntries(() => commands.createCreditEntry(customerId, date, type, amount));
  }

  const balances: Record<string, number> = balancesQuery.data ?? {};

  function balanceFor(customerId: string): number {
    return balances[customerId] ?? 0;
  }

  return {
    customers: customersQuery.data ?? [],
    history: historyQuery.data ?? [],
    addCustomer,
    deleteCustomer,
    adjustCustomer,
    balanceFor,
  };
}

export type { CustomerHistoryRow };
