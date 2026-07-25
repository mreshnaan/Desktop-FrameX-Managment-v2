import { useMemo } from 'react';
import { usePullData } from './usePullData';
import type { Billing } from '@/lib/shared';

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
    const stationsByCategory = new Map<string, CategoryStation[]>();
    for (const station of query.data.stations) {
      const list = stationsByCategory.get(station.categoryId) ?? [];
      list.push({ id: station.id, name: station.name });
      stationsByCategory.set(station.categoryId, list);
    }
    return query.data.categories.map(c => ({
      id: c.id,
      name: c.name,
      billingType: c.billingType,
      stations: stationsByCategory.get(c.id) ?? [],
    }));
  }, [query.data]);

  return { categories, isLoading: query.isLoading };
}
