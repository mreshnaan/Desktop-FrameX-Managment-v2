import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
          hour: c.billingType === 'time' ? 0 : null,
          half: c.billingType === 'time' ? 0 : null,
          value: c.billingType === 'frame' ? 0 : null,
          updatedAt: new Date().toISOString(),
        };
        return { ...base, categoryName: c.name, billingType: c.billingType };
      });
    },
  });

  const setRate = useMutation({
    mutationFn: (row: { categoryId: string; hour: number | null; half: number | null; value: number | null }) =>
      commands.upsertRate(row.categoryId, row.hour, row.half, row.value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates'] }),
  });

  return { rates: query.data ?? [], setRate };
}
