import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
  flexRender,
} from '@tanstack/react-table';
import {
  WEEKDAYS,
  MONTHS,
  dateStrOf,
  parseDate,
  formatCurrency,
  type Session,
} from '@/lib/shared';
import { db } from '@/lib/db/dexie';
import { useCategories } from '@/lib/hooks/useCategories';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface MonthlySalesViewProps {
  onJumpToDate: (date: string) => void;
}

interface MonthCursor {
  year: number;
  month: number; // 0-indexed
}

interface DayRow {
  date: string;
  Cash: number;
  Card: number;
  Credit: number;
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
  columnHelper.accessor('Card', {
    header: 'Card',
    cell: info => formatCurrency(info.getValue()),
  }),
  columnHelper.accessor('Cash', {
    header: 'Cash',
    cell: info => formatCurrency(info.getValue()),
  }),
  columnHelper.accessor('Credit', {
    header: 'Credit',
    cell: info => formatCurrency(info.getValue()),
  }),
  columnHelper.accessor('total', {
    header: 'Total',
    cell: info => formatCurrency(info.getValue()),
  }),
];

export default function MonthlySalesView({ onJumpToDate }: MonthlySalesViewProps) {
  const { categories } = useCategories();
  const [cursor, setCursor] = useState<MonthCursor>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const monthStart = dateStrOf(new Date(cursor.year, cursor.month, 1));
  const monthEnd = dateStrOf(new Date(cursor.year, cursor.month + 1, 0));
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['month-sessions', cursor.year, cursor.month],
    queryFn: async () => {
      const all = await db.sessions.where('date').between(monthStart, monthEnd, true, true).toArray();
      return all.filter(s => !s.deletedAt);
    },
  });

  const rows = useMemo<DayRow[]>(() => {
    const byDate = new Map<string, Session[]>();
    for (const s of sessions) {
      const arr = byDate.get(s.date) ?? [];
      arr.push(s);
      byDate.set(s.date, arr);
    }
    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = dateStrOf(new Date(cursor.year, cursor.month, i + 1));
      const daySessions = byDate.get(date) ?? [];
      const row: DayRow = { date, Cash: 0, Card: 0, Credit: 0, total: 0 };
      for (const s of daySessions) {
        row[s.method] += s.amount;
        row.total += s.amount;
      }
      return row;
    });
  }, [sessions, cursor, daysInMonth]);

  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    const categoryNameByStationId = new Map<string, string>();
    for (const category of categories) {
      totals[category.name] = 0;
      for (const station of category.stations) categoryNameByStationId.set(station.id, category.name);
    }
    for (const s of sessions) {
      const categoryName = categoryNameByStationId.get(s.stationId);
      if (categoryName) totals[categoryName] = (totals[categoryName] ?? 0) + s.amount;
    }
    return totals;
  }, [sessions, categories]);

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {categories.map(category => (
          <Card key={category.id}>
            <CardHeader>
              <CardTitle>{category.name}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {formatCurrency(categoryTotals[category.name] ?? 0)}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="px-0">
          {isLoading ? (
            <p className="px-4 text-sm text-muted-foreground">Loading sessions…</p>
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
