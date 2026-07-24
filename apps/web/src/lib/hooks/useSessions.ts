import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox, type RateRow } from '../db/dexie';
import { calcTimeAmount, calcFrameAmount, type Session } from '@/lib/shared';

// Always returns a usable rate for a known category: the persisted Dexie row
// if one has synced down, otherwise a zero-valued fallback so a fresh
// install that hasn't finished its first-run bootstrap pull yet doesn't
// crash (see App.tsx's blocking pull-before-render, which makes this
// fallback rare in practice).
async function loadRate(categoryId: string): Promise<RateRow> {
  const existing = await db.rates.where('categoryId').equals(categoryId).first();
  if (existing) return existing;
  return { id: '', categoryId, hour: 0, half: 0, value: 0, updatedAt: new Date().toISOString() };
}

export function useSessions(date: string) {
  const qc = useQueryClient();
  const key = ['sessions', date];

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const all = await db.sessions.where('date').equals(date).toArray();
      return all.filter(s => !s.deletedAt);
    },
  });

  async function persist(session: Session) {
    await db.sessions.put(session);
    await enqueueOutbox('sessions', 'upsert', session.id, session as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: key });
  }

  async function addSession(stationId: string, categoryId: string, billingType: 'time' | 'frame') {
    const rate = billingType === 'frame' ? await loadRate(categoryId) : null;
    const id = crypto.randomUUID();
    const session: Session = {
      id, stationId, date, start: '', end: '',
      amount: billingType === 'frame' ? calcFrameAmount(rate?.value ?? 0) : 0,
      method: 'Cash', customerId: null,
      updatedAt: new Date().toISOString(), deletedAt: null,
    };
    await persist(session);
  }

  async function updateSession(id: string, patch: Partial<Session>) {
    const existing = await db.sessions.get(id);
    if (!existing) return;
    let next: Session = { ...existing, ...patch, updatedAt: new Date().toISOString() };

    if (('start' in patch || 'end' in patch) && next.start && next.end) {
      const station = await db.stations.get(next.stationId);
      const category = station ? await db.categories.get(station.categoryId) : undefined;
      if (category?.billingType === 'time') {
        const rate = await loadRate(category.id);
        next.amount = calcTimeAmount(next.start, next.end, { hour: rate.hour ?? 0, half: rate.half ?? 0 });
      }
    }
    await persist(next);
  }

  async function deleteSession(id: string) {
    const existing = await db.sessions.get(id);
    if (!existing) return;
    const deleted: Session = { ...existing, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await db.sessions.put(deleted);
    await enqueueOutbox('sessions', 'delete', id, { id });
    await qc.invalidateQueries({ queryKey: key });
  }

  return { sessions: query.data ?? [], isLoading: query.isLoading, addSession, updateSession, deleteSession };
}
