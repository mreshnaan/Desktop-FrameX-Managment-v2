import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreditDraftSchema,
  formatCurrency,
  todayStr,
  toFieldErrors,
  type Customer,
  type CreditDraft,
  type CreditEntry,
} from '@/lib/shared';
import { commands, type CustomerHistoryRow } from '@/lib/tauri/commands';
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

export default function CreditManagementView() {
  const { customers, adjustCustomer, balanceFor } = useCustomers();

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
  adjustCustomer,
}: {
  customer: Customer;
  balance: number;
  adjustCustomer: AdjustCustomerFn;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreditDraft>({ resolver: zodResolver(CreditDraftSchema) });

  // Only fetched on-demand (when the user opens the history panel),
  // and scoped to this customer_id — the SQL UNION in the backend
  // returns the merged timeline pre-sorted; no JS filtering needed.
  const historyQuery = useQuery({
    queryKey: ['customer-credit-history', customer.id],
    queryFn: () => commands.getCustomerCreditHistory(customer.id),
    enabled: showHistory,
  });

  const rows: CustomerHistoryRow[] = historyQuery.data ?? [];

  const onGiveCredit = handleSubmit(async data => {
    await adjustCustomer(customer.id, todayStr(), 'CREDIT_GIVEN', data.amount);
    reset();
  });

  const onRecordPayment = handleSubmit(async data => {
    await adjustCustomer(customer.id, todayStr(), 'PAYMENT_RECEIVED', data.amount);
    reset();
  });

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
              aria-invalid={!!toFieldErrors(errors.amount)}
              {...register('amount')}
            />
            <FieldError errors={toFieldErrors(errors.amount)} />
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
            (historyQuery.isLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
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
