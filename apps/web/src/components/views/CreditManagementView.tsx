import { useMemo, useState } from 'react';
import { formatCurrency, type Customer, type CreditEntry, type Session } from '@/lib/shared';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface HistoryRow {
  id: string;
  date: string;
  label: string;
  amount: number;
  direction: 'charge' | 'payment';
}

// Read-only: giving credit / recording payments happens on the desktop app --
// web only displays the resulting balance and history per customer.
export default function CreditManagementView() {
  const { customers, history, sessions, balanceFor } = useCustomers();

  return (
    <div className="flex flex-col gap-4 p-4">
      {customers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No customers yet.</p>
      ) : (
        customers.map(customer => (
          <CustomerCreditCard
            key={customer.id}
            customer={customer}
            balance={balanceFor(customer.id)}
            history={history}
            sessions={sessions}
          />
        ))
      )}
    </div>
  );
}

function CustomerCreditCard({
  customer,
  balance,
  history,
  sessions,
}: {
  customer: Customer;
  balance: number;
  history: CreditEntry[];
  sessions: Session[];
}) {
  const [showHistory, setShowHistory] = useState(false);

  const rows = useMemo<HistoryRow[]>(() => {
    const charges: HistoryRow[] = sessions
      .filter(s => !s.deletedAt && s.method === 'Credit' && s.customerId === customer.id)
      .map(s => ({
        id: `session-${s.id}`,
        date: s.date,
        label: 'Table charge',
        amount: s.amount,
        direction: 'charge' as const,
      }));

    const manual: HistoryRow[] = history
      .filter(h => h.customerId === customer.id)
      .map(h => ({
        id: `credit-${h.id}`,
        date: h.date,
        label: h.type === 'CREDIT_GIVEN' ? 'Credit given' : 'Payment received',
        amount: h.amount,
        direction: h.type === 'CREDIT_GIVEN' ? ('charge' as const) : ('payment' as const),
      }));

    return [...charges, ...manual].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [sessions, history, customer.id]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{customer.name}</CardTitle>
          {customer.phone && <CardDescription>{customer.phone}</CardDescription>}
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Balance</div>
          <div className="text-lg font-semibold" data-testid={`balance-${customer.name}`}>
            {formatCurrency(balance)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={showHistory}
          onClick={() => setShowHistory(v => !v)}
          className="self-start"
        >
          {showHistory ? 'Hide history' : 'Show history'}
        </Button>
        {showHistory &&
          (rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map(row => (
                <li key={row.id} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">
                    {row.date} — {row.label}
                  </span>
                  <span
                    className={
                      row.direction === 'charge' ? 'font-medium text-destructive' : 'font-medium text-foreground'
                    }
                  >
                    {row.direction === 'charge' ? '+' : '−'}
                    {formatCurrency(row.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </CardContent>
    </Card>
  );
}
