import { useState } from 'react';
import { formatCurrency, type Customer } from '@/lib/shared';
import { useCustomers, useCustomerCreditHistory, type CustomerHistoryRow } from '@/lib/hooks/useCustomers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Read-only: giving credit / recording payments happens on the desktop app --
// web only displays the resulting balance and history per customer.
// Balance is pre-aggregated by /reports/customer-balances (server-side).
// History is lazy-fetched per customer from /reports/customer-credit-history/:id.
export default function CreditManagementView() {
  const { customers, balanceFor } = useCustomers();

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
          />
        ))
      )}
    </div>
  );
}

function CustomerCreditCard({
  customer,
  balance,
}: {
  customer: Customer;
  balance: number;
}) {
  const [showHistory, setShowHistory] = useState(false);

  // Lazy: only fetched when the user expands the panel.
  // Scoped to this customer_id — no full-table scan on the client.
  const historyQuery = useCustomerCreditHistory(customer.id, showHistory);
  const rows: CustomerHistoryRow[] = historyQuery.data ?? [];

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
          (historyQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
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
                      row.direction === 'charge'
                        ? 'font-medium text-destructive'
                        : 'font-medium text-foreground'
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
