import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands } from '../tauri/commands';
import type { Session } from '../shared/schemas/session.schema';

export function useSessions(date: string) {
  const qc = useQueryClient();
  const key = ['sessions', date];

  const query = useQuery({
    queryKey: key,
    queryFn: () => commands.listSessionsForDate(date),
  });

  const addSession = useMutation({
    mutationFn: (input: { stationId: string; categoryId: string; billingType: 'time' | 'frame' }) =>
      commands.createSession(input.stationId, input.categoryId, input.billingType, date),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const updateSession = useMutation({
    mutationFn: (input: { id: string; patch: Partial<Session> }) =>
      commands.updateSession(input.id, {
        start: input.patch.start,
        end: input.patch.end,
        amount: input.patch.amount,
        method: input.patch.method,
        customerId: input.patch.customerId,
        offerId: input.patch.offerId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const deleteSession = useMutation({
    mutationFn: (id: string) => commands.deleteSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return { sessions: query.data ?? [], isLoading: query.isLoading, addSession, updateSession, deleteSession };
}
