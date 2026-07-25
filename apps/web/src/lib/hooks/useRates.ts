import { useMemo } from 'react';
import type { Billing } from '@/lib/shared';
import { usePullData, type RateRow } from './usePullData';

export interface RateWithCategory extends RateRow {
  categoryName: string;
  billingType: Billing;
}

// Read-only: rates are set from the desktop app -- web only displays them.
export function useRates() {
  const query = usePullData();

  const rates = useMemo<RateWithCategory[]>(() => {
    if (!query.data) return [];
    const byCategoryId = new Map(query.data.rates.map(r => [r.categoryId, r]));
    return query.data.categories.map(c => {
      const existing = byCategoryId.get(c.id);
      const base: RateRow = existing ?? {
        id: '',
        categoryId: c.id,
        hour: c.billingType === 'time' ? 0 : null,
        half: c.billingType === 'time' ? 0 : null,
        value: c.billingType === 'frame' ? 0 : null,
        updatedAt: '',
      };
      return { ...base, categoryName: c.name, billingType: c.billingType };
    });
  }, [query.data]);

  return { rates, isLoading: query.isLoading };
}
