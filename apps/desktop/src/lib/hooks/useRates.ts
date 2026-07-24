import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type RateRow } from '../tauri/commands';

export interface RateWithCategory extends RateRow {
  categoryName: string;
  billingType: 'time' | 'frame';
}

export function useRates() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['rates'],
    queryFn: async (): Promise<RateWithCategory[]> => {
      const [categories, rateRows] = await Promise.all([commands.listCategories(), commands.listRates()]);
      const byCategoryId = new Map(rateRows.map(r => [r.categoryId, r]));
      return categories.map(c => {
        const existing = byCategoryId.get(c.id);
        const base: RateRow = existing ?? {
          id: '',
          categoryId: c.id,
          hourRate: c.billingType === 'time' ? 0 : null,
          halfRate: c.billingType === 'time' ? 0 : null,
          frameRate: c.billingType === 'frame' ? 0 : null,
          updatedAt: new Date().toISOString(),
        };
        return { ...base, categoryName: c.name, billingType: c.billingType };
      });
    },
  });

  async function setRate(row: { categoryId: string; hourRate: number | null; halfRate: number | null; frameRate: number | null }) {
    await commands.upsertRate(row.categoryId, row.hourRate, row.halfRate, row.frameRate);
    await qc.invalidateQueries({ queryKey: ['rates'] });
  }

  return { rates: query.data ?? [], setRate };
}
