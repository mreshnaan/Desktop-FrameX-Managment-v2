import { useMemo } from 'react';
import { usePullData } from './usePullData';

// Read-only: sessions are created/edited on the desktop app at the front
// desk -- web only displays them, grouped by category/station for the
// Daily Sales analytics view.
export function useSessions(date: string) {
  const query = usePullData();

  const sessions = useMemo(
    () => (query.data?.sessions ?? []).filter(s => !s.deletedAt && s.date === date),
    [query.data, date],
  );

  return { sessions, isLoading: query.isLoading };
}
