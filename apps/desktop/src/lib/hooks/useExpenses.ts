import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands } from '../tauri/commands';
import type { Expense } from '../shared/schemas/expense.schema';

export function useExpenses(date: string) {
  const qc = useQueryClient();
  const key = ['expenses', date];

  const query = useQuery({
    queryKey: key,
    queryFn: () => commands.listExpensesForDate(date),
  });

  // Broader than `key` alone: a backdated expense lands on a different day's
  // cache than the one currently being viewed, so addExpense invalidates
  // every cached expenses-day query instead of just this one.
  const addExpense = useMutation({
    mutationFn: (customDate?: string) => commands.createExpense(customDate ?? date),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const updateExpense = useMutation({
    mutationFn: (input: { id: string; patch: Partial<Expense> }) =>
      commands.updateExpense(input.id, input.patch.description, input.patch.amount, input.patch.method),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const deleteExpense = useMutation({
    mutationFn: (id: string) => commands.deleteExpense(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return { expenses: query.data ?? [], addExpense, updateExpense, deleteExpense };
}

// Bounded by date range at the Rust/SQL layer (list_expenses_between), the
// same pattern useSessions/listSessionsBetween and useOrdersBetween already
// use, for Monthly Expenses' day-by-day table.
export function useExpensesBetween(startDate: string, endDate: string) {
  const query = useQuery({
    queryKey: ['expenses', startDate, endDate],
    queryFn: () => commands.listExpensesBetween(startDate, endDate),
  });
  return { expenses: query.data ?? [], isLoading: query.isLoading };
}
