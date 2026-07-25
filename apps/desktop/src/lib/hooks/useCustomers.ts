import { useQueryClient, useQuery } from '@tanstack/react-query';
import { commands, type CustomerHistoryRow } from '../tauri/commands';

// Customer balances are pre-aggregated entirely in SQLite via
// get_customer_balances (reports.rs). The backend serialises the result
// as a plain JSON object { customerId: balance } so the frontend does
// ZERO computation — balanceFor is just a direct property lookup.
export function useCustomers() {
  const qc = useQueryClient();

  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: () => commands.listCustomers(),
  });

  // Returns Record<string, number> — a plain {customerId: balance} object.
  // No array.map, no reduce, no filter ever runs in the browser.
  const balancesQuery = useQuery({
    queryKey: ['customer-balances'],
    queryFn: () => commands.getCustomerBalances(),
  });

  const historyQuery = useQuery({
    queryKey: ['credit-entries'],
    queryFn: () => commands.listCreditEntries(),
  });

  async function addCustomer(input: { name: string; phone?: string }) {
    await commands.createCustomer(input.name, input.phone ?? '');
    await qc.invalidateQueries({ queryKey: ['customers'] });
    await qc.invalidateQueries({ queryKey: ['customer-balances'] });
  }

  async function deleteCustomer(id: string) {
    await commands.deleteCustomer(id);
    await qc.invalidateQueries({ queryKey: ['customers'] });
    await qc.invalidateQueries({ queryKey: ['customer-balances'] });
  }

  async function adjustCustomer(
    customerId: string,
    date: string,
    type: 'CREDIT_GIVEN' | 'PAYMENT_RECEIVED',
    amount: number,
  ) {
    await commands.createCreditEntry(customerId, date, type, amount);
    await qc.invalidateQueries({ queryKey: ['credit-entries'] });
    await qc.invalidateQueries({ queryKey: ['customer-balances'] });
  }

  // Direct property access — backend owns the lookup table, frontend reads it.
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
