import { useMemo } from 'react';
import { usePullData } from './usePullData';
import { groupBy, type Billing } from '@/lib/shared';

export interface CategoryStation {
  id: string;
  name: string;
}

export interface CategoryWithStations {
  id: string;
  name: string;
  billingType: Billing;
  stations: CategoryStation[];
}

// Read-only: categories/stations are seeded server-side (apps/api/prisma/seed.ts).
export function useCategories() {
  const query = usePullData();

  const categories = useMemo<CategoryWithStations[]>(() => {
    if (!query.data) return [];
    const stationsByCategory = groupBy(query.data.stations, s => s.categoryId);
    return query.data.categories.map(c => ({
      id: c.id,
      name: c.name,
      billingType: c.billingType,
      stations: (stationsByCategory.get(c.id) ?? []).map(s => ({ id: s.id, name: s.name })),
    }));
  }, [query.data]);

  return { categories, isLoading: query.isLoading };
}
