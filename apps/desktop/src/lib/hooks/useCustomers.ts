import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type CustomerHistoryRow } from '../tauri/commands';

// Balances are pre-aggregated in SQLite via get_customer_balances --
// balanceFor is just a direct property lookup, no client-side computation.
export function useCustomers() {
  const qc = useQueryClient();

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

  const addCustomer = useMutation({
    mutationFn: (input: { name: string; phone?: string }) =>
      commands.createCustomer(input.name, input.phone ?? ''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer-balances'] });
    },
  });

  const deleteCustomer = useMutation({
    mutationFn: (id: string) => commands.deleteCustomer(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer-balances'] });
    },
  });

  const adjustCustomer = useMutation({
    mutationFn: (input: {
      customerId: string;
      date: string;
      type: 'CREDIT_GIVEN' | 'PAYMENT_RECEIVED';
      amount: number;
    }) => commands.createCreditEntry(input.customerId, input.date, input.type, input.amount),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit-entries'] });
      qc.invalidateQueries({ queryKey: ['customer-balances'] });
    },
  });

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
