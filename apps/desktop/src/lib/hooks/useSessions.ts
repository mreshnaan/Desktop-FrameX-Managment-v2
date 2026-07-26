import { useQuery } from '@tanstack/react-query';
import { commands } from '../tauri/commands';
import type { Session } from '../shared/schemas/session.schema';
import { useInvalidateAfter } from './useInvalidateAfter';

export function useSessions(date: string) {
  const key = ['sessions', date];
  const invalidate = useInvalidateAfter(key);

  const query = useQuery({
    queryKey: key,
    queryFn: () => commands.listSessionsForDate(date),
  });

  async function addSession(stationId: string, categoryId: string, billingType: 'time' | 'frame') {
    await invalidate(() => commands.createSession(stationId, categoryId, billingType, date));
  }

  async function updateSession(id: string, patch: Partial<Session>) {
    await invalidate(() => commands.updateSession(id, {
      start: patch.start,
      end: patch.end,
      amount: patch.amount,
      method: patch.method,
      customerId: patch.customerId,
    }));
  }

  async function deleteSession(id: string) {
    await invalidate(() => commands.deleteSession(id));
  }

  return { sessions: query.data ?? [], isLoading: query.isLoading, addSession, updateSession, deleteSession };
}
