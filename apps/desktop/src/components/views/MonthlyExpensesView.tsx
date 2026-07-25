import { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
} from '@tanstack/react-table';
import { WEEKDAYS, MONTHS, dateStrOf, parseDate, formatCurrency } from '@/lib/shared';
import { useExpensesBetween } from '@/lib/hooks/useExpenses';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface MonthlyExpensesViewProps {
  onJumpToDate: (date: string) => void;
}

interface MonthCursor {
  year: number;
  month: number; // 0-indexed
}

interface DayRow {
  date: string;
  total: number;
}

const columnHelper = createColumnHelper<DayRow>();

function formatDayLabel(dateStr: string): string {
  const d = parseDate(dateStr);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
}

const columns = [
  columnHelper.accessor('date', {
    header: 'Date',
    cell: info => formatDayLabel(info.getValue()),
  }),
  columnHelper.accessor('total', {
    header: 'Total',
    cell: info => formatCurrency(info.getValue()),
  }),
];

export default function MonthlyExpensesView({ onJumpToDate }: MonthlyExpensesViewProps) {
  const [cursor, setCursor] = useState<MonthCursor>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const monthStart = dateStrOf(new Date(cursor.year, cursor.month, 1));
  const monthEnd = dateStrOf(new Date(cursor.year, cursor.month + 1, 0));
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();

  const { expenses, isLoading } = useExpensesBetween(monthStart, monthEnd);

  const rows = useMemo<DayRow[]>(() => {
    const totalByDate = new Map<string, number>();
    for (const e of expenses) {
      totalByDate.set(e.date, (totalByDate.get(e.date) ?? 0) + e.amount);
    }
    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = dateStrOf(new Date(cursor.year, cursor.month, i + 1));
      return { date, total: totalByDate.get(date) ?? 0 };
    });
  }, [expenses, cursor, daysInMonth]);

  const monthTotal = useMemo(() => expenses.reduce((sum, e) => sum + e.amount, 0), [expenses]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  function stepMonth(delta: number) {
    setCursor(prev => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function goToThisMonth() {
    const d = new Date();
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <h1 className="text-xl font-semibold">Monthly Expenses</h1>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => stepMonth(-1)}>
            ‹
          </Button>
          <div className="min-w-44 text-center text-lg font-semibold">
            {MONTHS[cursor.month]} {cursor.year}
          </div>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => stepMonth(1)}>
            ›
          </Button>
        </div>
        <Button variant="outline" onClick={goToThisMonth}>
          This month
        </Button>
      </div>

      <Card size="sm" className="max-w-56">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Total expenses</CardTitle>
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{formatCurrency(monthTotal)}</CardContent>
      </Card>

      <Card>
        <CardContent className="px-0">
          {isLoading ? (
            <ListSkeleton />
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map(headerGroup => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <TableHead key={header.id}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map(row => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => onJumpToDate(row.original.date)}
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
