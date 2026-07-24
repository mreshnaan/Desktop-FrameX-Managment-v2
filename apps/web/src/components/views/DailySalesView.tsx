import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { SessionSchema, formatCurrency, type Session, type Customer, type Billing } from '@/lib/shared';
import { useSessions } from '@/lib/hooks/useSessions';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { useCategories, type CategoryWithStations, type CategoryStation } from '@/lib/hooks/useCategories';
import DateStepper from '@/components/layout/DateStepper';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldError } from '@/components/ui/field';

interface DailySalesViewProps {
  date: string;
  onDateChange: (date: string) => void;
}

interface Summary {
  total: number;
  Cash: number;
  Card: number;
  Credit: number;
}

type UpdateSessionFn = (id: string, patch: Partial<Session>) => Promise<void>;
type AddSessionFn = (stationId: string, categoryId: string, billingType: Billing) => Promise<void>;
type DeleteSessionFn = (id: string) => Promise<void>;

export default function DailySalesView({ date, onDateChange }: DailySalesViewProps) {
  const { sessions, isLoading, addSession, updateSession, deleteSession } = useSessions(date);
  const { customers } = useCustomers();
  const { categories } = useCategories();

  const summary = useMemo<Summary>(() => {
    const totals: Summary = { total: 0, Cash: 0, Card: 0, Credit: 0 };
    for (const s of sessions) {
      totals.total += s.amount;
      totals[s.method] += s.amount;
    }
    return totals;
  }, [sessions]);

  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="text-xl font-semibold">Daily Sales</h1>
      <DateStepper date={date} onDateChange={onDateChange} />
      <SummaryStrip summary={summary} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading sessions…</p>
      ) : (
        <div className="flex flex-col gap-6">
          {categories.map(category => (
            <CategoryGroup
              key={category.id}
              category={category}
              sessions={sessions.filter(s => category.stations.some(st => st.id === s.stationId))}
              customers={customers}
              addSession={addSession}
              updateSession={updateSession}
              deleteSession={deleteSession}
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
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
  sessions,
  customers,
  addSession,
  updateSession,
  deleteSession,
}: {
  category: CategoryWithStations;
  sessions: Session[];
  customers: Customer[];
  addSession: AddSessionFn;
  updateSession: UpdateSessionFn;
  deleteSession: DeleteSessionFn;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{category.name}</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {category.stations.map(station => (
          <StationCard
            key={station.id}
            category={category}
            station={station}
            sessions={sessions.filter(s => s.stationId === station.id)}
            customers={customers}
            addSession={addSession}
            updateSession={updateSession}
            deleteSession={deleteSession}
          />
        ))}
      </div>
    </section>
  );
}

function StationCard({
  category,
  station,
  sessions,
  customers,
  addSession,
  updateSession,
  deleteSession,
}: {
  category: CategoryWithStations;
  station: CategoryStation;
  sessions: Session[];
  customers: Customer[];
  addSession: AddSessionFn;
  updateSession: UpdateSessionFn;
  deleteSession: DeleteSessionFn;
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
            updateSession={updateSession}
            deleteSession={deleteSession}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => addSession(station.id, category.id, category.billingType)}
        >
          + Add session
        </Button>
      </CardContent>
    </Card>
  );
}

function SessionRow({
  session,
  frameNumber,
  billing,
  customers,
  updateSession,
  deleteSession,
}: {
  session: Session;
  frameNumber: number;
  billing: Billing;
  customers: Customer[];
  updateSession: UpdateSessionFn;
  deleteSession: DeleteSessionFn;
}) {
  const [amountDraft, setAmountDraft] = useState(String(session.amount));
  const [error, setError] = useState<string | null>(null);
  const amountFocused = useRef(false);

  useEffect(() => {
    if (!amountFocused.current) setAmountDraft(String(session.amount));
  }, [session.amount]);

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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Cash">Cash</SelectItem>
            <SelectItem value="Card">Card</SelectItem>
            <SelectItem value="Credit">Credit</SelectItem>
          </SelectContent>
        </Select>

        {customers.length > 0 ? (
          <Select
            value={session.customerId}
            onValueChange={value => commit({ customerId: value })}
          >
            <SelectTrigger className="w-36" aria-label="Customer">
              {/* SelectValue only resolves a display label from the registered
                  `items`/`itemToStringLabel` root props, not from SelectItem
                  children/label — since customerId (the value) differs from
                  the customer's name (the label), it must be resolved
                  explicitly here or the trigger renders the raw id. */}
              <SelectValue placeholder="No customer">
                {(value: string | null) => customers.find(c => c.id === value)?.name ?? 'No customer'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null} label="No customer">No customer</SelectItem>
              {customers.map(c => (
                <SelectItem key={c.id} value={c.id} label={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            className="w-36 justify-start text-muted-foreground"
          >
            Add customers first
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete session"
          onClick={() => deleteSession(session.id)}
        >
          <Trash2 className="text-destructive" />
        </Button>
      </div>
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </div>
  );
}
