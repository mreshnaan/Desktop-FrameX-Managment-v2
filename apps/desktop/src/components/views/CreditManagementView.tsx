import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreditDraftSchema,
  formatCurrency,
  todayStr,
  type Customer,
  type CreditDraft,
  type CreditEntry,
  type Session,
} from '@/lib/shared';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';

type AdjustCustomerFn = (
  customerId: string,
  date: string,
  type: CreditEntry['type'],
  amount: number
) => Promise<void>;

interface HistoryRow {
  id: string;
  date: string;
  label: string;
  amount: number;
  direction: 'charge' | 'payment';
}

export default function CreditManagementView() {
  const { customers, history, sessions, adjustCustomer, balanceFor } = useCustomers();

  return (
    <div className="flex flex-col gap-4 p-4">
      {customers.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Balances include Credit-paid table sessions automatically. Use the fields below only for
          credit given or paid outside the daily sheet.
        </p>
      )}
      {customers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No customers yet. Add a customer on the Customers view to start tracking credit.
        </p>
      ) : (
        customers.map(customer => (
          <CustomerCreditCard
            key={customer.id}
            customer={customer}
            balance={balanceFor(customer.id)}
            history={history}
            sessions={sessions}
            adjustCustomer={adjustCustomer}
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
  adjustCustomer,
}: {
  customer: Customer;
  balance: number;
  history: CreditEntry[];
  sessions: Session[];
  adjustCustomer: AdjustCustomerFn;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreditDraft>({ resolver: zodResolver(CreditDraftSchema) });

  // Two distinct submit actions share one amount field. Each button gets its
  // own handleSubmit-wrapped handler (rather than one handler branching on
  // shared state), so there is no risk of the "wrong" action firing.
  const onGiveCredit = handleSubmit(async data => {
    await adjustCustomer(customer.id, todayStr(), 'CREDIT_GIVEN', data.amount);
    reset();
  });

  const onRecordPayment = handleSubmit(async data => {
    await adjustCustomer(customer.id, todayStr(), 'PAYMENT_RECEIVED', data.amount);
    reset();
  });

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
      <CardContent className="flex flex-col gap-4">
        <FieldGroup className="@md/field-group:flex-row @md/field-group:items-end">
          <Field className="@md/field-group:max-w-40">
            <FieldLabel htmlFor={`amount-${customer.id}`}>Amount</FieldLabel>
            <Input
              id={`amount-${customer.id}`}
              data-testid={`draft-amount-${customer.name}`}
              type="number"
              min={1}
              step={1}
              placeholder="0"
              aria-invalid={!!errors.amount}
              {...register('amount')}
            />
            <FieldError errors={errors.amount ? [errors.amount] : undefined} />
          </Field>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onGiveCredit}>
              Give credit
            </Button>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onRecordPayment}>
              Record payment
            </Button>
          </div>
        </FieldGroup>

        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showHistory}
            onClick={() => setShowHistory(v => !v)}
          >
            {showHistory ? 'Hide history' : 'Show history'}
          </Button>
          {showHistory &&
            (rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No history yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
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
        </div>
      </CardContent>
    </Card>
  );
}
