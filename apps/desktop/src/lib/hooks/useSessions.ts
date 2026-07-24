import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type SessionRow } from '../tauri/commands';

export function useSessions(date: string) {
  const qc = useQueryClient();
  const key = ['sessions', date];

  const query = useQuery({
    queryKey: key,
    queryFn: () => commands.listSessionsForDate(date),
  });

  async function addSession(stationId: string, categoryId: string, billingType: 'time' | 'frame') {
    await commands.createSession(stationId, categoryId, billingType, date);
    await qc.invalidateQueries({ queryKey: key });
  }

  async function updateSession(id: string, patch: Partial<SessionRow>) {
    await commands.updateSession(id, {
      start: patch.start,
      end: patch.end,
      amount: patch.amount,
      method: patch.method,
      customerId: patch.customerId,
    });
    await qc.invalidateQueries({ queryKey: key });
  }

  async function deleteSession(id: string) {
    await commands.deleteSession(id);
    await qc.invalidateQueries({ queryKey: key });
  }

  return { sessions: query.data ?? [], isLoading: query.isLoading, addSession, updateSession, deleteSession };
}
