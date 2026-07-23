import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ExpenseDraftSchema, formatCurrency, type Expense } from '@cue-room/shared';
import { useExpenses } from '@/lib/hooks/useExpenses';
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

const ExpensePatchSchema = ExpenseDraftSchema.partial();

interface ExpensesViewProps {
  date: string;
  onDateChange: (date: string) => void;
}

type UpdateExpenseFn = (id: string, patch: Partial<Expense>) => Promise<void>;
type DeleteExpenseFn = (id: string) => Promise<void>;

export default function ExpensesView({ date, onDateChange }: ExpensesViewProps) {
  const { expenses, addExpense, updateExpense, deleteExpense } = useExpenses(date);

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
          {expenses.length === 0 && (
            <p className="text-sm text-muted-foreground">No expenses recorded for this day.</p>
          )}
          {expenses.map(expense => (
            <ExpenseRow
              key={expense.id}
              expense={expense}
              updateExpense={updateExpense}
              deleteExpense={deleteExpense}
            />
          ))}
          <Button variant="outline" size="sm" className="self-start" onClick={() => addExpense()}>
            + Add expense
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ExpenseRow({
  expense,
  updateExpense,
  deleteExpense,
}: {
  expense: Expense;
  updateExpense: UpdateExpenseFn;
  deleteExpense: DeleteExpenseFn;
}) {
  const [descriptionDraft, setDescriptionDraft] = useState(expense.description);
  const [amountDraft, setAmountDraft] = useState(String(expense.amount));
  const [error, setError] = useState<string | null>(null);
  const descriptionFocused = useRef(false);
  const amountFocused = useRef(false);

  useEffect(() => {
    if (!descriptionFocused.current) setDescriptionDraft(expense.description);
  }, [expense.description]);

  useEffect(() => {
    if (!amountFocused.current) setAmountDraft(String(expense.amount));
  }, [expense.amount]);

  async function commit(patch: Partial<Expense>) {
    const result = ExpensePatchSchema.safeParse(patch);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Invalid value');
      return;
    }
    setError(null);
    await updateExpense(expense.id, patch);
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={descriptionDraft}
          placeholder="Description"
          onFocus={() => {
            descriptionFocused.current = true;
          }}
          onChange={e => setDescriptionDraft(e.target.value)}
          onBlur={() => {
            descriptionFocused.current = false;
            commit({ description: descriptionDraft });
          }}
          className="min-w-40 flex-1"
          aria-label="Description"
        />

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
          value={expense.method}
          onValueChange={value => commit({ method: value as Expense['method'] })}
        >
          <SelectTrigger className="w-28" aria-label="Payment method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Cash">Cash</SelectItem>
            <SelectItem value="Card">Card</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete expense"
          onClick={() => deleteExpense(expense.id)}
        >
          <Trash2 className="text-destructive" />
        </Button>
      </div>
      <FieldError errors={error ? [{ message: error }] : undefined} />
    </div>
  );
}
