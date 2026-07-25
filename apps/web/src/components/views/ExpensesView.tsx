import { useMemo } from 'react';
import { formatCurrency, type Expense } from '@/lib/shared';
import { useExpenses } from '@/lib/hooks/useExpenses';
import DateStepper from '@/components/layout/DateStepper';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ExpensesViewProps {
  date: string;
  onDateChange: (date: string) => void;
}

// Read-only: expenses are recorded on the desktop app -- web only displays
// the day's entries and total.
export default function ExpensesView({ date, onDateChange }: ExpensesViewProps) {
  const { expenses } = useExpenses(date);

  const total = useMemo(() => expenses.reduce((sum, e) => sum + e.amount, 0), [expenses]);

  return (
    <div className="flex flex-col gap-6 p-4">
      <DateStepper date={date} onDateChange={onDateChange} />

      <Card size="sm" className="max-w-56">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Total expenses</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{formatCurrency(total)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expenses</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No expenses recorded for this day.</p>
          ) : (
            expenses.map(expense => <ExpenseRow key={expense.id} expense={expense} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ExpenseRow({ expense }: { expense: Expense }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2 text-sm" data-testid="expense-row">
      <span className="min-w-40 flex-1">{expense.description}</span>
      <span className="font-medium">{formatCurrency(expense.amount)}</span>
      <span className="text-muted-foreground">{expense.method}</span>
    </div>
  );
}
