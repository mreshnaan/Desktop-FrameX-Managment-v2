import { useMemo } from 'react';
import { formatCurrency, groupBy, type Session, type Customer, type Billing } from '@/lib/shared';
import { useSessions } from '@/lib/hooks/useSessions';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { useCategories, type CategoryWithStations, type CategoryStation } from '@/lib/hooks/useCategories';
import { useOffers } from '@/lib/hooks/useOffers';
import type { OfferRow } from '@/lib/hooks/usePullData';
import DateStepper from '@/components/layout/DateStepper';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollapsibleSection } from '@/components/ui/collapsible-section';

interface DailySalesViewProps {
  date: string;
  onDateChange: (date: string) => void;
}

interface Summary {
  total: number;
  Cash: number;
  Card: number;
  Credit: number;
  Pending: number;
}

export default function DailySalesView({ date, onDateChange }: DailySalesViewProps) {
  const { sessions, isLoading, isError } = useSessions(date);
  const { customers } = useCustomers();
  const { categories } = useCategories();
  const { offers } = useOffers();

  const summary = useMemo<Summary>(() => {
    const totals: Summary = { total: 0, Cash: 0, Card: 0, Credit: 0, Pending: 0 };
    for (const s of sessions) {
      totals.total += s.amount;
      if (s.method) {
        totals[s.method] += s.amount;
      } else {
        totals.Pending += s.amount;
      }
    }
    return totals;
  }, [sessions]);

  // Single grouping pass instead of re-filtering the day's sessions once per
  // category (here) and again once per station (in CategoryGroup).
  const sessionsByStationId = useMemo(() => groupBy(sessions, s => s.stationId), [sessions]);

  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="text-xl font-semibold">Daily Sales</h1>
      <DateStepper date={date} onDateChange={onDateChange} />
      <SummaryStrip summary={summary} />

      {isError ? (
        <p className="text-sm text-destructive">Couldn't load — check your connection and try again.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading sessions…</p>
      ) : (
        <div className="flex flex-col gap-6">
          {categories.map(category => (
            <CategoryGroup
              key={category.id}
              category={category}
              sessionsByStationId={sessionsByStationId}
              customers={customers}
              offers={offers}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryStrip({ summary }: { summary: Summary }) {
  const items: { label: string; value: number }[] = [
    { label: 'Total', value: summary.total },
    { label: 'Card', value: summary.Card },
    { label: 'Cash', value: summary.Cash },
    { label: 'Credit', value: summary.Credit },
    { label: 'Pending', value: summary.Pending },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map(item => (
        <Card key={item.label} size="sm">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">{item.label}</CardTitle>
          </CardHeader>
          <CardContent
            className="text-2xl font-semibold"
            data-testid={`summary-${item.label.toLowerCase()}`}
          >
            {formatCurrency(item.value)}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CategoryGroup({
  category,
  sessionsByStationId,
  customers,
  offers,
}: {
  category: CategoryWithStations;
  sessionsByStationId: Map<string, Session[]>;
  customers: Customer[];
  offers: OfferRow[];
}) {
  const categoryTotal = useMemo(
    () => category.stations.reduce(
      (sum, station) => sum + (sessionsByStationId.get(station.id) ?? []).reduce((s, session) => s + session.amount, 0),
      0,
    ),
    [category.stations, sessionsByStationId],
  );

  return (
    <CollapsibleSection title={category.name} subtitle={formatCurrency(categoryTotal)}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {category.stations.map(station => (
          <StationCard
            key={station.id}
            category={category}
            station={station}
            sessions={sessionsByStationId.get(station.id) ?? []}
            customers={customers}
            offers={offers}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

function StationCard({
  category,
  station,
  sessions,
  customers,
  offers,
}: {
  category: CategoryWithStations;
  station: CategoryStation;
  sessions: Session[];
  customers: Customer[];
  offers: OfferRow[];
}) {
  const subtotal = useMemo(() => sessions.reduce((sum, s) => sum + s.amount, 0), [sessions]);

  return (
    <Card data-testid={`resource-card-${category.name}-${station.name}`}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{station.name}</CardTitle>
        <span className="text-sm font-medium text-muted-foreground">{formatCurrency(subtotal)}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">No sessions yet.</p>
        )}
        {sessions.map((session, index) => (
          <SessionRow
            key={session.id}
            session={session}
            frameNumber={index + 1}
            billing={category.billingType}
            customers={customers}
            offers={offers}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SessionRow({
  session,
  frameNumber,
  billing,
  customers,
  offers,
}: {
  session: Session;
  frameNumber: number;
  billing: Billing;
  customers: Customer[];
  offers: OfferRow[];
}) {
  const customerName = session.customerId
    ? (customers.find(c => c.id === session.customerId)?.name ?? 'Unknown customer')
    : null;
  const offerName = (id: string) => offers.find(o => o.id === id)?.name ?? 'Offer';

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2 text-sm" data-testid="session-row">
      {billing === 'time' ? (
        <span className="text-muted-foreground">
          {session.start || '—'} – {session.end || '—'}
        </span>
      ) : (
        <span className="text-muted-foreground">Frame {frameNumber}</span>
      )}
      <span className="font-medium">{formatCurrency(session.amount)}</span>
      <span className="text-muted-foreground">{session.method ?? 'Pending'}</span>
      {customerName && <span className="text-muted-foreground">{customerName}</span>}
      {session.offerId && (
        <span className="text-muted-foreground">
          {offerName(session.offerId)} (−{formatCurrency(session.discountAmount ?? 0)})
        </span>
      )}
    </div>
  );
}
