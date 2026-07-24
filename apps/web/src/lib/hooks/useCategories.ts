import { useQuery } from '@tanstack/react-query';
import { db } from '../db/dexie';
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

// Read-only: categories/stations are seeded server-side (apps/api/prisma/seed.ts)
// and populated locally by sync -- nothing in apps/web ever writes to
// db.categories/db.stations.
export function useCategories() {
  const query = useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<CategoryWithStations[]> => {
      const [categories, stations] = await Promise.all([db.categories.toArray(), db.stations.toArray()]);
      const stationsByCategory = new Map<string, CategoryStation[]>();
      for (const station of stations) {
        const list = stationsByCategory.get(station.categoryId) ?? [];
        list.push({ id: station.id, name: station.name });
        stationsByCategory.set(station.categoryId, list);
      }
      return categories.map(c => ({
        id: c.id,
        name: c.name,
        billingType: c.billingType,
        stations: stationsByCategory.get(c.id) ?? [],
      }));
    },
  });

  return { categories: query.data ?? [], isLoading: query.isLoading };
}
