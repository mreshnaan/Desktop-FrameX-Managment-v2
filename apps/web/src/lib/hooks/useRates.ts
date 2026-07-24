import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db, enqueueOutbox, type RateRow } from '../db/dexie';
import type { Billing } from '@/lib/shared';

export interface RateWithCategory extends RateRow {
  categoryName: string;
  billingType: Billing;
}

export function useRates() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['rates'],
    queryFn: async (): Promise<RateWithCategory[]> => {
      const [categories, rateRows] = await Promise.all([db.categories.toArray(), db.rates.toArray()]);
      const byCategoryId = new Map(rateRows.map(r => [r.categoryId, r]));
      return categories.map(c => {
        const existing = byCategoryId.get(c.id);
        const base: RateRow = existing ?? {
          id: crypto.randomUUID(),
          categoryId: c.id,
          hour: c.billingType === 'time' ? 0 : null,
          half: c.billingType === 'time' ? 0 : null,
          value: c.billingType === 'frame' ? 0 : null,
          updatedAt: new Date().toISOString(),
        };
        return { ...base, categoryName: c.name, billingType: c.billingType };
      });
    },
  });

  async function setRate(row: RateRow) {
    const next = { ...row, updatedAt: new Date().toISOString() };
    await db.rates.put(next);
    await enqueueOutbox('rates', 'upsert', next.id, next as unknown as Record<string, unknown>);
    await qc.invalidateQueries({ queryKey: ['rates'] });
  }

  return { rates: query.data ?? [], setRate };
}
