import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox, type RateRow } from '../db/dexie';
import { CATEGORIES, DEFAULT_RATES } from '@cue-room/shared';

export function useRates() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['rates'],
    queryFn: async () => {
      const rows = await db.rates.toArray();
      const byCategory = new Map(rows.map(r => [r.category, r]));
      return CATEGORIES.map(c => {
        const existing = byCategory.get(c.name);
        if (existing) return existing;
        const def = DEFAULT_RATES[c.name];
        const defIsFrame = typeof def === 'number';
        return c.billing === 'frame'
          ? { category: c.name, hour: null, half: null, value: defIsFrame ? def : 0, updatedAt: new Date().toISOString() }
          : { category: c.name, hour: defIsFrame ? 0 : def.hour, half: defIsFrame ? 0 : def.half, value: null, updatedAt: new Date().toISOString() };
      });
    },
  });

  async function setRate(row: RateRow) {
    const next = { ...row, updatedAt: new Date().toISOString() };
    await db.rates.put(next);
    await enqueueOutbox('rates', 'upsert', row.category, next as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: ['rates'] });
  }

  return { rates: query.data ?? [], setRate };
}
