import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type ExpenseRow } from '../tauri/commands';

export function useExpenses(date: string) {
  const qc = useQueryClient();
  const key = ['expenses', date];

  const query = useQuery({
    queryKey: key,
    queryFn: () => commands.listExpensesForDate(date),
  });

  async function addExpense() {
    await commands.createExpense(date);
    await qc.invalidateQueries({ queryKey: key });
  }

  async function updateExpense(id: string, patch: Partial<ExpenseRow>) {
    await commands.updateExpense(id, patch.description, patch.amount, patch.method);
    await qc.invalidateQueries({ queryKey: key });
  }

  async function deleteExpense(id: string) {
    await commands.deleteExpense(id);
    await qc.invalidateQueries({ queryKey: key });
  }

  return { expenses: query.data ?? [], addExpense, updateExpense, deleteExpense };
}
