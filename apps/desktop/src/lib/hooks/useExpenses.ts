import { useQuery } from '@tanstack/react-query';
import { commands } from '../tauri/commands';
import type { Expense } from '../shared/schemas/expense.schema';
import { useInvalidateAfter } from './useInvalidateAfter';

export function useExpenses(date: string) {
  const key = ['expenses', date];
  // Broader than `key` alone: a backdated expense lands on a different day's
  // cache than the one currently being viewed, so addExpense invalidates
  // every cached expenses-day query instead of just this one.
  const invalidateAllDays = useInvalidateAfter(['expenses']);
  const invalidateThisDay = useInvalidateAfter(key);

  const query = useQuery({
    queryKey: key,
    queryFn: () => commands.listExpensesForDate(date),
  });

  // Defaults to the day currently being viewed, but a cashier recording a
  // receipt from an earlier day doesn't have to navigate away first --
  // create_expense already took a date param, it was just never exposed.
  async function addExpense(customDate?: string) {
    await invalidateAllDays(() => commands.createExpense(customDate ?? date));
  }

  async function updateExpense(id: string, patch: Partial<Expense>) {
    await invalidateThisDay(() => commands.updateExpense(id, patch.description, patch.amount, patch.method));
  }

  async function deleteExpense(id: string) {
    await invalidateThisDay(() => commands.deleteExpense(id));
  }

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
