import { useQuery } from '@tanstack/react-query';
import { commands } from '../tauri/commands';
import { groupBy } from '../shared/utils/groupBy';

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
      const stationsByCategory = groupBy(stations, s => s.categoryId);
      return categories.map(c => ({
        id: c.id,
        name: c.name,
        billingType: c.billingType,
        stations: (stationsByCategory.get(c.id) ?? []).map(s => ({ id: s.id, name: s.name })),
      }));
    },
  });

  return { categories: query.data ?? [], isLoading: query.isLoading };
}
