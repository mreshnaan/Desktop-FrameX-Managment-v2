import { usePullData } from './usePullData';

export function useOffers() {
  const query = usePullData();
  return { offers: query.data?.offers ?? [], isLoading: query.isLoading };
}
