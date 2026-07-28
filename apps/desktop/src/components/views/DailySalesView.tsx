import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { UseMutationResult } from '@tanstack/react-query';
import {
  SessionSchema,
  formatCurrency,
  todayStr,
  nowTimeStr,
  addMinutesToTime,
  durationMinutes,
  groupBy,
  toFieldErrors,
  dayOfWeek,
  type Session,
  type Customer,
  type Billing,
} from '@/lib/shared';
import { useSessions } from '@/lib/hooks/useSessions';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { useCategories, type CategoryWithStations, type CategoryStation } from '@/lib/hooks/useCategories';
import { useOrdersBetween, orderTimeOf } from '@/lib/hooks/useOrders';
import { useProducts } from '@/lib/hooks/useProducts';
import { useOffers } from '@/lib/hooks/useOffers';
import { commands, type OrderRow, type OrderItemRow, type OfferRow } from '@/lib/tauri/commands';
import DateStepper from '@/components/layout/DateStepper';
import { CustomerCombobox } from '@/components/CustomerCombobox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldError } from '@/components/ui/field';
import { ListSkeleton } from '@/components/ui/list-skeleton';

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

type UpdateSessionFn = (id: string, patch: Partial<Session>) => Promise<void>;
type DeleteSessionFn = (id: string) => Promise<void>;

export default function DailySalesView({ date, onDateChange }: DailySalesViewProps) {
  const { sessions, isLoading, addSession, updateSession, deleteSession } = useSessions(date);
  const { customers } = useCustomers();
  const { categories } = useCategories();
  const { orders: dayOrders, orderItems } = useOrdersBetween(date, date);
  const { products } = useProducts();
  const { offers } = useOffers();

  const cafe = useMemo(() => {
    const costByProductId = new Map(products.map(p => [p.id, p.cost ?? 0]));
    const dayOrderIds = new Set(dayOrders.map(o => o.id));
    const byMethod: Summary = { total: 0, Cash: 0, Card: 0, Credit: 0, Pending: 0 };
    for (const o of dayOrders) {
      byMethod.total += o.total;
      byMethod[o.method] += o.total;
    }
    let profit = 0;
    for (const item of orderItems) {
      if (!dayOrderIds.has(item.orderId)) continue;
      profit += item.lineTotal - (costByProductId.get(item.productId) ?? 0) * item.qty;
    }
    return { byMethod, profit };
  }, [dayOrders, orderItems, products]);

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
    // Cafe sales fold into the same Total/Cash/Card/Credit figure as sessions.
    totals.total += cafe.byMethod.total;
    totals.Cash += cafe.byMethod.Cash;
    totals.Card += cafe.byMethod.Card;
    totals.Credit += cafe.byMethod.Credit;
    return totals;
  }, [sessions, cafe]);

  // Single grouping pass instead of re-filtering the day's sessions once per
  // category (here) and again once per station (in CategoryGroup).
  const sessionsByStationId = useMemo(() => groupBy(sessions, s => s.stationId), [sessions]);

  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="text-xl font-semibold">Daily Sales</h1>
      <DateStepper date={date} onDateChange={onDateChange} />
      <SummaryStrip summary={summary} />

      {isLoading ? (
        <ListSkeleton />
      ) : (
        <div className="flex flex-col gap-6">
          {categories.map(category => (
            <CategoryGroup
              key={category.id}
              date={date}
              category={category}
              sessionsByStationId={sessionsByStationId}
              customers={customers}
              offers={offers}
              addSession={addSession}
              updateSession={updateSession}
              deleteSession={deleteSession}
            />
          ))}
          <CafeSection orders={dayOrders} orderItems={orderItems} revenue={cafe.byMethod.total} profit={cafe.profit} />
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
  date,
  category,
  sessionsByStationId,
  customers,
  offers,
  addSession,
  updateSession,
  deleteSession,
}: {
  date: string;
  category: CategoryWithStations;
  sessionsByStationId: Map<string, Session[]>;
  customers: Customer[];
  offers: OfferRow[];
  addSession: UseMutationResult<Session, Error, { stationId: string; categoryId: string; billingType: 'time' | 'frame' }>;
  updateSession: UseMutationResult<Session, Error, { id: string; patch: Partial<Session> }>;
  deleteSession: UseMutationResult<void, Error, string>;
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
            date={date}
            category={category}
            station={station}
            sessions={sessionsByStationId.get(station.id) ?? []}
            customers={customers}
            offers={offers}
            addSession={addSession}
            updateSession={updateSession}
            deleteSession={deleteSession}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

function StationCard({
  date,
  category,
  station,
  sessions,
  customers,
  offers,
  addSession,
  updateSession,
  deleteSession,
}: {
  date: string;
  category: CategoryWithStations;
  station: CategoryStation;
  sessions: Session[];
  customers: Customer[];
  offers: OfferRow[];
  addSession: UseMutationResult<Session, Error, { stationId: string; categoryId: string; billingType: 'time' | 'frame' }>;
  updateSession: UseMutationResult<Session, Error, { id: string; patch: Partial<Session> }>;
  deleteSession: UseMutationResult<void, Error, string>;
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
            date={date}
            category={category}
            session={session}
            frameNumber={index + 1}
            billing={category.billingType}
            customers={customers}
            offers={offers}
            updateSession={(id, patch) => updateSession.mutateAsync({ id, patch }).then(() => undefined)}
            deleteSession={(id) => deleteSession.mutateAsync(id).then(() => undefined)}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => addSession.mutate({ stationId: station.id, categoryId: category.id, billingType: category.billingType })}
        >
          + Add session
        </Button>
      </CardContent>
    </Card>
  );
}

// Read-only -- a sale is rung up from the Cafe screen, not edited here.
// A product with no cost set contributes 0 cost, not an error.
function CafeSection({
  orders,
  orderItems,
  revenue,
  profit,
}: {
  orders: OrderRow[];
  orderItems: OrderItemRow[];
  revenue: number;
  profit: number;
}) {
  const [showOrders, setShowOrders] = useState(false);
  const itemCountByOrder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of orderItems) counts.set(item.orderId, (counts.get(item.orderId) ?? 0) + item.qty);
    return counts;
  }, [orderItems]);

  return (
    <CollapsibleSection title="Cafe" subtitle={formatCurrency(revenue)}>
      <Card data-testid="cafe-summary-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Cafe sales</CardTitle>
          <div className="flex gap-4 text-sm">
            <span className="text-muted-foreground">
              Revenue <span className="font-medium text-foreground">{formatCurrency(revenue)}</span>
            </span>
            <span className="text-muted-foreground">
              Profit <span className="font-medium text-foreground">{formatCurrency(profit)}</span>
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cafe sales yet.</p>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                aria-expanded={showOrders}
                onClick={() => setShowOrders(v => !v)}
              >
                {showOrders ? 'Hide orders' : 'Show orders'}
              </Button>
              {showOrders && (
                <ul className="flex flex-col gap-1">
                  {orders.map(o => (
                    <li key={o.id} className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-muted-foreground">
                        {orderTimeOf(o.updatedAt)} — {itemCountByOrder.get(o.id) ?? 0} item(s) — {o.method}
                      </span>
                      <span className="font-medium">{formatCurrency(o.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </CollapsibleSection>
  );
}

const QUICK_DURATIONS = [30, 60, 90, 120];

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

export function offerAppliesTo(offer: OfferRow, categoryId: string): boolean {
  if (offer.appliesToAllCategories) return true;
  return (offer.categoryIds ?? '').split(',').includes(categoryId);
}

export function isOfferActiveOn(offer: OfferRow, dateStr: string, timeStr: string): boolean {
  if (offer.startDate && dateStr < offer.startDate) return false;
  if (offer.endDate && dateStr > offer.endDate) return false;
  if (offer.days) {
    const codes = offer.days.split(',');
    const code = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dayOfWeek(dateStr)];
    if (!codes.includes(code)) return false;
  }
  if (offer.startTime && offer.endTime) {
    const wraps = offer.startTime > offer.endTime;
    const inWindow = wraps
      ? (timeStr >= offer.startTime || timeStr <= offer.endTime)
      : (timeStr >= offer.startTime && timeStr <= offer.endTime);
    if (!inWindow) return false;
  } else {
    if (offer.startTime && timeStr < offer.startTime) return false;
    if (offer.endTime && timeStr > offer.endTime) return false;
  }
  return true;
}

function SessionRow({
  date,
  category,
  session,
  frameNumber,
  billing,
  customers,
  offers,
  updateSession,
  deleteSession,
}: {
  date: string;
  category: CategoryWithStations;
  session: Session;
  frameNumber: number;
  billing: Billing;
  customers: Customer[];
  offers: OfferRow[];
  updateSession: UpdateSessionFn;
  deleteSession: DeleteSessionFn;
}) {
  const [amountDraft, setAmountDraft] = useState(String(session.amount));
  const [error, setError] = useState<string | null>(null);
  const amountFocused = useRef(false);
  const [eligibleOfferId, setEligibleOfferId] = useState<string | null>(null);

  useEffect(() => {
    if (!amountFocused.current) setAmountDraft(String(session.amount));
  }, [session.amount]);

  useEffect(() => {
    if (session.offerId) { setEligibleOfferId(null); return; }
    if (date !== todayStr()) { setEligibleOfferId(null); return; }
    let cancelled = false;

    async function checkEligibility() {
      const candidates = offers.filter(o => o.active && offerAppliesTo(o, category.id));
      const nowTime = billing === 'time' && session.start ? session.start : nowTimeStr();
      for (const offer of candidates) {
        if (!isOfferActiveOn(offer, date, nowTime)) continue;
        if (offer.minDurationMinutes != null) {
          if (billing !== 'time' || !session.start || !session.end) continue;
          if (durationMinutes(session.start, session.end) < offer.minDurationMinutes) continue;
        }
        if (offer.minGameCount != null) {
          if (billing !== 'frame' || !session.customerId) continue;
          const count = await commands.countSessionsToday(date, category.id, session.customerId);
          // Per the design spec, eligibility triggers exactly once -- on the
          // Nth session, not on the Nth and every session after it. `count`
          // already includes this session (it's persisted with customerId
          // set by the time this effect runs, since there's no optimistic
          // update), so the Nth session is exactly where count == minGameCount.
          if (count !== offer.minGameCount) continue;
        }
        if (!cancelled) setEligibleOfferId(offer.id);
        return;
      }
      if (!cancelled) setEligibleOfferId(null);
    }

    checkEligibility();
    return () => { cancelled = true; };
  }, [session.offerId, session.start, session.end, session.customerId, offers, category.id, billing, date]);

  async function commit(patch: Partial<Session>) {
    const merged: Session = { ...session, ...patch };
    const result = SessionSchema.safeParse(merged);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Invalid value');
      return;
    }
    setError(null);
    await updateSession(session.id, patch);
  }

  // Quick actions only apply to today -- not another day's closed records.
  const isToday = date === todayStr();
  const now = nowTimeStr();
  const canSetDuration = billing === 'time' && isToday && !!session.start;
  // Comparing "HH:MM" strings breaks across midnight -- measure both as
  // elapsed-since-start instead (durationMinutes already wraps correctly).
  const hasEnded =
    !session.start || !session.end || durationMinutes(session.start, now) >= durationMinutes(session.start, session.end);
  const canExtend = billing === 'time' && isToday && !!session.end && !hasEnded;

  function applyDuration(minutes: number) {
    if (!session.start) return;
    commit({ end: addMinutesToTime(session.start, minutes) });
  }

  function extend(minutes: number) {
    if (!session.end) return;
    commit({ end: addMinutesToTime(session.end, minutes) });
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-2" data-testid="session-row">
      <div className="flex flex-wrap items-center gap-2">
        {billing === 'time' ? (
          <>
            <Input
              type="time"
              value={session.start}
              onChange={e => commit({ start: e.target.value })}
              className="w-28"
              aria-label="Start time"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="time"
              value={session.end}
              onChange={e => commit({ end: e.target.value })}
              className="w-28"
              aria-label="End time"
            />
          </>
        ) : (
          <span className="w-20 shrink-0 text-sm text-muted-foreground">Frame {frameNumber}</span>
        )}

        <Input
          type="number"
          value={amountDraft}
          onFocus={() => {
            amountFocused.current = true;
          }}
          onChange={e => setAmountDraft(e.target.value)}
          onBlur={() => {
            amountFocused.current = false;
            commit({ amount: Number(amountDraft) || 0 });
          }}
          className="w-24"
          aria-label="Amount"
        />

        <Select
          value={session.method}
          onValueChange={value => commit({ method: value as Session['method'] })}
        >
          <SelectTrigger className="w-28" aria-label="Payment method">
            <SelectValue placeholder="Select payment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Cash">Cash</SelectItem>
            <SelectItem value="Card">Card</SelectItem>
            <SelectItem value="Credit">Credit</SelectItem>
          </SelectContent>
        </Select>

        <CustomerCombobox
          customers={customers}
          value={session.customerId}
          onChange={value => commit({ customerId: value })}
        />

        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete session"
          onClick={() => deleteSession(session.id)}
        >
          <Trash2 className="text-destructive" />
        </Button>
      </div>
      {eligibleOfferId && (
        <div className="flex items-center gap-2 text-sm">
          <span>🎉 {offers.find(o => o.id === eligibleOfferId)?.name} available —</span>
          <Button type="button" size="xs" variant="link" className="h-auto p-0" onClick={() => commit({ offerId: eligibleOfferId })}>
            Apply?
          </Button>
        </div>
      )}
      {session.offerId && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{offers.find(o => o.id === session.offerId)?.name ?? 'Offer'} applied — saved {formatCurrency(session.discountAmount ?? 0)}</span>
          <Button type="button" size="xs" variant="link" className="h-auto p-0" onClick={() => commit({ offerId: null })}>
            Remove
          </Button>
        </div>
      )}
      {billing === 'time' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">QUICK:</span>
          {QUICK_DURATIONS.map(minutes => (
            <Button
              key={minutes}
              type="button"
              variant="link"
              size="xs"
              disabled={!canSetDuration}
              onClick={() => applyDuration(minutes)}
              className="h-auto p-0"
            >
              +{formatDuration(minutes)}
            </Button>
          ))}
          <span className="text-border" aria-hidden="true">|</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            disabled={!canExtend}
            onClick={() => extend(30)}
            className="h-auto p-0"
          >
            Extend +30m
          </Button>
        </div>
      )}
      <FieldError errors={toFieldErrors(error)} />
    </div>
  );
}
