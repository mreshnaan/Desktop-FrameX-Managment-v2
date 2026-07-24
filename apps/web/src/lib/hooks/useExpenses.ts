import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox } from '../db/dexie';
import type { Expense } from '@/lib/shared';

export function useExpenses(date: string) {
  const qc = useQueryClient();
  const key = ['expenses', date];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await db.expenses.where('date').equals(date).toArray()).filter(e => !e.deletedAt),
  });

  async function addExpense() {
    const id = crypto.randomUUID();
    const expense: Expense = { id, date, description: '', amount: 0, method: 'Cash', updatedAt: new Date().toISOString(), deletedAt: null };
    await db.expenses.put(expense);
    await enqueueOutbox('expenses', 'upsert', id, expense as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: key });
  }

  async function updateExpense(id: string, patch: Partial<Expense>) {
    const existing = await db.expenses.get(id);
    if (!existing) return;
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await db.expenses.put(next);
    await enqueueOutbox('expenses', 'upsert', id, next as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: key });
  }

  async function deleteExpense(id: string) {
    const existing = await db.expenses.get(id);
    if (!existing) return;
    const next = { ...existing, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.expenses.put(next);
    await enqueueOutbox('expenses', 'delete', id, { id });
    await qc.invalidateQueries({ queryKey: key });
  }

  return { expenses: query.data ?? [], addExpense, updateExpense, deleteExpense };
}
