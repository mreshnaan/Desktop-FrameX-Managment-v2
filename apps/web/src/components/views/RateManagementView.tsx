import { useRates, type RateWithCategory } from '@/lib/hooks/useRates';
import { formatCurrency } from '@/lib/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Read-only: rates are set on the desktop app -- web only displays them.
export default function RateManagementView() {
  const { rates } = useRates();

  return (
    <div className="flex flex-col gap-4 p-4">
      {rates.map(row => (
        <RateCard key={row.categoryId} row={row} />
      ))}
    </div>
  );
}

function RateCard({ row }: { row: RateWithCategory }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{row.categoryName}</CardTitle>
      </CardHeader>
      <CardContent className="flex gap-6 text-sm">
        {row.billingType === 'time' ? (
          <>
            <div>
              <div className="text-xs text-muted-foreground">Rate per 60 min</div>
              <div className="text-lg font-semibold">{formatCurrency(row.hour ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Rate per 30 min</div>
              <div className="text-lg font-semibold">{formatCurrency(row.half ?? 0)}</div>
            </div>
          </>
        ) : (
          <div>
            <div className="text-xs text-muted-foreground">Rate per frame</div>
            <div className="text-lg font-semibold">{formatCurrency(row.value ?? 0)}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
