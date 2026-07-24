import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox } from '../db/dexie';
import type { Customer, CreditEntry } from '@/lib/shared';
import { calcCustomerBalance } from '@/lib/shared';

export function useCustomers() {
  const qc = useQueryClient();
  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: async () => (await db.customers.toArray()).filter(c => !c.deletedAt),
  });
  const sessionsQuery = useQuery({
    queryKey: ['all-sessions'],
    queryFn: async () => (await db.sessions.toArray()).filter(s => !s.deletedAt),
  });
  const historyQuery = useQuery({ queryKey: ['credit-entries'], queryFn: () => db.creditEntries.toArray() });

  async function addCustomer(input: { name: string; phone?: string }) {
    const id = crypto.randomUUID();
    const customer: Customer = { id, name: input.name, phone: input.phone ?? '', updatedAt: new Date().toISOString(), deletedAt: null };
    await db.customers.put(customer);
    await enqueueOutbox('customers', 'upsert', id, customer as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: ['customers'] });
  }

  async function deleteCustomer(id: string) {
    const existing = await db.customers.get(id);
    if (!existing) return;
    const next = { ...existing, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.customers.put(next);
    await enqueueOutbox('customers', 'delete', id, { id });
    await qc.invalidateQueries({ queryKey: ['customers'] });
  }

  async function adjustCustomer(customerId: string, date: string, type: CreditEntry['type'], amount: number) {
    const id = crypto.randomUUID();
    const entry: CreditEntry = { id, customerId, date, type, amount, updatedAt: new Date().toISOString() };
    await db.creditEntries.put(entry);
    await enqueueOutbox('creditEntries', 'upsert', id, entry as unknown as Record<string, unknown>);
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
