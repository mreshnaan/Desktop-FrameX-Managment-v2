import { useOffers } from '@/lib/hooks/useOffers';
import { useCategories } from '@/lib/hooks/useCategories';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Read-only: offers are managed on the desktop app -- web only displays them.
export default function OfferManagementView() {
  const { offers } = useOffers();
  const { categories } = useCategories();

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Offers</h1>
      {offers.map(offer => (
        <Card key={offer.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{offer.name}</CardTitle>
            <span className="text-sm text-muted-foreground">{offer.active ? 'Active' : 'Inactive'}</span>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {offer.appliesToAllCategories
              ? 'All categories'
              : (offer.categoryIds ?? '').split(',').map(id => categories.find(c => c.id === id)?.name ?? id).join(', ')}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
