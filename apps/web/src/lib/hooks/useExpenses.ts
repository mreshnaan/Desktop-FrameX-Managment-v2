import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import type { Expense } from '@/lib/shared';

// Read-only: expense entry/editing is a desktop-only workflow -- web only
// displays the day's recorded expenses, bounded via GET /expenses?date=.
export function useExpenses(date: string) {
  const { state } = useAuth();

  const query = useQuery({
    queryKey: ['expenses', date],
    queryFn: () => apiFetch<Expense[]>(`/expenses?date=${date}`, { accessToken: state.accessToken }),
    enabled: !!state.accessToken,
  });

  return { expenses: query.data ?? [], isLoading: query.isLoading };
}
