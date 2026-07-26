import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/useAuth';
import { apiFetch } from '@/lib/api/client';
import type { Session } from '@/lib/shared';

// Read-only: sessions are created/edited on the desktop app -- web only
// displays them, bounded to one day via GET /sessions?date=.
export function useSessions(date: string) {
  const { state } = useAuth();

  const query = useQuery({
    queryKey: ['sessions', date],
    queryFn: () => apiFetch<Session[]>(`/sessions?date=${date}`, { accessToken: state.accessToken }),
    enabled: !!state.accessToken,
  });

  return { sessions: query.data ?? [], isLoading: query.isLoading };
}
