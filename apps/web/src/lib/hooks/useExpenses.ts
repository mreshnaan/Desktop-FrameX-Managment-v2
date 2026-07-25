import { useMemo } from 'react';
import { usePullData } from './usePullData';

// Read-only: expense entry/editing is a desktop-only workflow -- web only
// displays the day's recorded expenses and their total.
export function useExpenses(date: string) {
  const query = usePullData();

  const expenses = useMemo(
    () => (query.data?.expenses ?? []).filter(e => !e.deletedAt && e.date === date),
    [query.data, date],
  );

  return { expenses, isLoading: query.isLoading };
}
