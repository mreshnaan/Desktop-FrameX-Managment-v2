import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox, type RateRow } from '../db/dexie';
import { CATEGORIES, DEFAULT_RATES, calcTimeAmount, calcFrameAmount, type Session } from '@/lib/shared';

// Always returns a usable rate for a known category: the persisted Dexie row
// if one has been saved via Rate Management, otherwise a RateRow built from
// DEFAULT_RATES (mirrors the fallback in useRates.ts) so a fresh install with
// no saved rates still auto-calculates session amounts.
async function loadRate(category: string): Promise<RateRow> {
  const existing = await db.rates.get(category);
  if (existing) return existing;

  const conf = CATEGORIES.find(c => c.name === category);
  const def = DEFAULT_RATES[category];
  const defIsFrame = typeof def === 'number';
  return conf?.billing === 'frame'
    ? { category, hour: null, half: null, value: defIsFrame ? def : 0, updatedAt: new Date().toISOString() }
    : { category, hour: defIsFrame ? 0 : def?.hour ?? 0, half: defIsFrame ? 0 : def?.half ?? 0, value: null, updatedAt: new Date().toISOString() };
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
      amount: conf.billing === 'frame' ? calcFrameAmount(rate.value ?? 0) : 0,
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
      // loadRate always resolves to a real rate (persisted or DEFAULT_RATES fallback)
      // for any category present in CATEGORIES, so no `if (rate)` guard is needed here.
      const rate = await loadRate(next.category);
      next.amount = calcTimeAmount(next.start, next.end, { hour: rate.hour ?? 0, half: rate.half ?? 0 });
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
