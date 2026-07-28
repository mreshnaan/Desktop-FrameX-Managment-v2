import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type OfferInput } from '../tauri/commands';

export function useOffers() {
  const qc = useQueryClient();

  const offersQuery = useQuery({
    queryKey: ['offers'],
    queryFn: () => commands.listOffers(),
  });

  const addOffer = useMutation({
    mutationFn: (input: OfferInput) => commands.createOffer(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers'] }),
  });

  const updateOffer = useMutation({
    mutationFn: ({ id, input }: { id: string; input: OfferInput }) => commands.updateOffer(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers'] }),
  });

  return { offers: offersQuery.data ?? [], isLoading: offersQuery.isLoading, addOffer, updateOffer };
}
