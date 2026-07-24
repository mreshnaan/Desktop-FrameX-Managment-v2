import { useQuery } from '@tanstack/react-query';
import { commands } from '../tauri/commands';

export interface CategoryStation {
  id: string;
  name: string;
}

export interface CategoryWithStations {
  id: string;
  name: string;
  billingType: 'time' | 'frame';
  stations: CategoryStation[];
}

// Read-only: categories/stations are seeded server-side and populated
// locally by sync -- nothing in this app ever writes to them directly.
export function useCategories() {
  const query = useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<CategoryWithStations[]> => {
      const [categories, stations] = await Promise.all([commands.listCategories(), commands.listStations()]);
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
