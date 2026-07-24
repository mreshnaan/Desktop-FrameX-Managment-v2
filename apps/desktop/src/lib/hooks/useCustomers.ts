import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commands } from '../tauri/commands';
import { calcCustomerBalance } from '@/lib/shared';

export function useCustomers() {
  const qc = useQueryClient();
  const customersQuery = useQuery({ queryKey: ['customers'], queryFn: () => commands.listCustomers() });
  const sessionsQuery = useQuery({ queryKey: ['all-sessions'], queryFn: () => commands.listAllSessions() });
  const ordersQuery = useQuery({ queryKey: ['orders'], queryFn: () => commands.listAllOrders() });
  const historyQuery = useQuery({ queryKey: ['credit-entries'], queryFn: () => commands.listCreditEntries() });

  async function addCustomer(input: { name: string; phone?: string }) {
    await commands.createCustomer(input.name, input.phone ?? '');
    await qc.invalidateQueries({ queryKey: ['customers'] });
  }

  async function deleteCustomer(id: string) {
    await commands.deleteCustomer(id);
    await qc.invalidateQueries({ queryKey: ['customers'] });
  }

  async function adjustCustomer(
    customerId: string,
    date: string,
    type: 'CREDIT_GIVEN' | 'PAYMENT_RECEIVED',
    amount: number,
  ) {
    await commands.createCreditEntry(customerId, date, type, amount);
    await qc.invalidateQueries({ queryKey: ['credit-entries'] });
  }

  // A Credit-method cafe order is debt the same way a Credit-method table
  // session is -- calcCustomerBalance only needs {method, customerId,
  // amount}, so orders (which carry `total` instead of `amount`) are mapped
  // into that shape and merged in here rather than teaching the shared
  // money.ts helper about a second, cafe-specific collection.
  const balanceSessions = useMemo(() => {
    const orders = (ordersQuery.data ?? []).map(o => ({
      method: o.method, customerId: o.customerId, amount: o.total,
    }));
    return [...(sessionsQuery.data ?? []), ...orders];
  }, [sessionsQuery.data, ordersQuery.data]);

  function balanceFor(customerId: string): number {
    return calcCustomerBalance(balanceSessions, historyQuery.data ?? [], customerId);
  }

  return {
    customers: customersQuery.data ?? [],
    history: historyQuery.data ?? [],
    sessions: sessionsQuery.data ?? [],
    addCustomer, deleteCustomer, adjustCustomer, balanceFor,
  };
}
