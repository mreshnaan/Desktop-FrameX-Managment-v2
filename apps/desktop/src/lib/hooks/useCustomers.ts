import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commands } from '../tauri/commands';
import { calcCustomerBalance } from '@/lib/shared';

export function useCustomers() {
  const qc = useQueryClient();
  const customersQuery = useQuery({ queryKey: ['customers'], queryFn: () => commands.listCustomers() });
  const sessionsQuery = useQuery({ queryKey: ['all-sessions'], queryFn: () => commands.listAllSessions() });
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

  function balanceFor(customerId: string): number {
    return calcCustomerBalance(sessionsQuery.data ?? [], historyQuery.data ?? [], customerId);
  }

  return {
    customers: customersQuery.data ?? [],
    history: historyQuery.data ?? [],
    sessions: sessionsQuery.data ?? [],
    addCustomer, deleteCustomer, adjustCustomer, balanceFor,
  };
}
