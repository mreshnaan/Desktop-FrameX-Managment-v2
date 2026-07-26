import { useQuery } from '@tanstack/react-query';
import { commands, type RateRow } from '../tauri/commands';
import { useInvalidateAfter } from './useInvalidateAfter';

export interface RateWithCategory extends RateRow {
  categoryName: string;
  billingType: 'time' | 'frame';
}

export function useRates() {
  const invalidate = useInvalidateAfter([['rates']]);
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
          hour: c.billingType === 'time' ? 0 : null,
          half: c.billingType === 'time' ? 0 : null,
          value: c.billingType === 'frame' ? 0 : null,
          updatedAt: new Date().toISOString(),
        };
        return { ...base, categoryName: c.name, billingType: c.billingType };
      });
    },
  });

  async function setRate(row: { categoryId: string; hour: number | null; half: number | null; value: number | null }) {
    await invalidate(() => commands.upsertRate(row.categoryId, row.hour, row.half, row.value));
  }

  return { rates: query.data ?? [], setRate };
}
