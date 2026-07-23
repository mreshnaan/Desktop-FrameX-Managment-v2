import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox } from '../db/dexie';
import { CATEGORIES, calcTimeAmount, calcFrameAmount, type Session } from '@cue-room/shared';

async function loadRate(category: string) {
  return db.rates.get(category);
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

  async function addSession(category: string, resource: string) {
    const conf = CATEGORIES.find(c => c.name === category)!;
    const rate = await loadRate(category);
    const id = crypto.randomUUID();
    const session: Session = {
      id, category, resource, date, start: '', end: '',
      amount: conf.billing === 'frame' ? calcFrameAmount((rate?.value ?? 0)) : 0,
      method: 'Cash', customerId: null,
      updatedAt: new Date().toISOString(), deletedAt: null,
    };
    await persist(session);
  }

  async function updateSession(id: string, patch: Partial<Session>) {
    const existing = await db.sessions.get(id);
    if (!existing) return;
    let next: Session = { ...existing, ...patch, updatedAt: new Date().toISOString() };

    const conf = CATEGORIES.find(c => c.name === next.category)!;
    if (conf.billing === 'time' && ('start' in patch || 'end' in patch) && next.start && next.end) {
      const rate = await loadRate(next.category);
      if (rate) next.amount = calcTimeAmount(next.start, next.end, { hour: rate.hour ?? 0, half: rate.half ?? 0 });
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
