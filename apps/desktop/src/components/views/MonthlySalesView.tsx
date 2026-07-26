import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import {
  WEEKDAYS,
  MONTHS,
  dateStrOf,
  parseDate,
  formatCurrency,
  localDateRangeToUtc,
} from '@/lib/shared';
import { commands } from '@/lib/tauri/commands';
import { useCategories } from '@/lib/hooks/useCategories';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable } from '@/components/ui/data-table';

interface MonthlySalesViewProps {
  onJumpToDate: (date: string) => void;
}

interface MonthCursor {
  year: number;
  month: number;
}

interface AllDayRow {
  date: string;
  tableSales: number;
  cafeSales: number;
  grossTotal: number;
  expensesTotal: number;
  netTotal: number;
}

interface CategoryDayRow {
  date: string;
  Cash: number;
  Card: number;
  Credit: number;
  total: number;
}

interface CafeDayRow {
  date: string;
  Cash: number;
  Card: number;
  Credit: number;
  total: number;
  profit: number;
}

interface ExpensesDayRow {
  date: string;
  Cash: number;
  Card: number;
  total: number;
}

type AnyDayRow = AllDayRow | CafeDayRow | ExpensesDayRow | CategoryDayRow;

function formatDayLabel(dateStr: string): string {
  const d = parseDate(dateStr);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
}

export default function MonthlySalesView({ onJumpToDate }: MonthlySalesViewProps) {
  const { categories } = useCategories();
  const [filter, setFilter] = useState<string>('all');
  const [cursor, setCursor] = useState<MonthCursor>(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const monthStart = dateStrOf(new Date(cursor.year, cursor.month, 1));
  const monthEnd = dateStrOf(new Date(cursor.year, cursor.month + 1, 0));
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();

  const { startUtc, endUtc } = useMemo(
    () => localDateRangeToUtc(monthStart, monthEnd),
    [monthStart, monthEnd],
  );

  // High-performance pre-aggregated backend report query:
  const { data: report, isLoading } = useQuery({
    queryKey: ['monthly-report', cursor.year, cursor.month],
    queryFn: () => commands.getMonthlyReport(monthStart, monthEnd, startUtc, endUtc),
  });

  const sessionTotals = report?.sessionTotals ?? [];
  const expenseTotals = report?.expenseTotals ?? [];
  const cafeTotals = report?.cafeTotals ?? [];

  // Top overall financial metrics computed from pre-aggregated backend sums
  const overallFinancials = useMemo(() => {
    const totalTableSales = sessionTotals.reduce((sum, s) => sum + s.total, 0);
    const totalCafeSales = cafeTotals.reduce((sum, c) => sum + c.total, 0);
    const cafeProfit = cafeTotals.reduce((sum, c) => sum + c.profit, 0);
    const totalGrossRevenue = totalTableSales + totalCafeSales;
    const totalExpenses = expenseTotals.reduce((sum, e) => sum + e.total, 0);
    const netProfit = totalGrossRevenue - totalExpenses;
    return { totalTableSales, totalCafeSales, cafeProfit, totalGrossRevenue, totalExpenses, netProfit };
  }, [sessionTotals, cafeTotals, expenseTotals]);

  // Category totals for top cards
  const categoryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const category of categories) {
      totals[category.id] = 0;
    }
    for (const s of sessionTotals) {
      totals[s.categoryId] = (totals[s.categoryId] ?? 0) + s.total;
    }
    return totals;
  }, [categories, sessionTotals]);

  // Fast day rows construction using Map lookups over aggregated data:
  const allRows = useMemo<AllDayRow[]>(() => {
    const tableByDate = new Map<string, number>();
    for (const s of sessionTotals) {
      tableByDate.set(s.date, (tableByDate.get(s.date) ?? 0) + s.total);
    }
    const cafeByDate = new Map<string, number>();
    for (const c of cafeTotals) {
      cafeByDate.set(c.date, (cafeByDate.get(c.date) ?? 0) + c.total);
    }
    const expensesByDate = new Map<string, number>();
    for (const e of expenseTotals) {
      expensesByDate.set(e.date, (expensesByDate.get(e.date) ?? 0) + e.total);
    }

    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = dateStrOf(new Date(cursor.year, cursor.month, i + 1));
      const tableSales = tableByDate.get(date) ?? 0;
      const cafeSales = cafeByDate.get(date) ?? 0;
      const grossTotal = tableSales + cafeSales;
      const expensesTotal = expensesByDate.get(date) ?? 0;
      const netTotal = grossTotal - expensesTotal;
      return { date, tableSales, cafeSales, grossTotal, expensesTotal, netTotal };
    });
  }, [sessionTotals, cafeTotals, expenseTotals, cursor, daysInMonth]);

  const categoryRows = useMemo<CategoryDayRow[]>(() => {
    if (!filter.startsWith('cat-')) return [];
    const catId = filter.replace('cat-', '');

    const byDate = new Map<string, { Cash: number; Card: number; Credit: number; total: number }>();
    for (const s of sessionTotals) {
      if (s.categoryId !== catId) continue;
      const entry = byDate.get(s.date) ?? { Cash: 0, Card: 0, Credit: 0, total: 0 };
      if (s.method === 'Cash' || s.method === 'Card' || s.method === 'Credit') {
        entry[s.method] += s.total;
      }
      entry.total += s.total;
      byDate.set(s.date, entry);
    }

    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = dateStrOf(new Date(cursor.year, cursor.month, i + 1));
      const entry = byDate.get(date) ?? { Cash: 0, Card: 0, Credit: 0, total: 0 };
      return { date, ...entry };
    });
  }, [filter, sessionTotals, cursor, daysInMonth]);

  const cafeRows = useMemo<CafeDayRow[]>(() => {
    const cafeByDate = new Map<string, { Cash: number; Card: number; Credit: number; total: number; profit: number }>();
    for (const c of cafeTotals) {
      const entry = cafeByDate.get(c.date) ?? { Cash: 0, Card: 0, Credit: 0, total: 0, profit: 0 };
      if (c.method === 'Cash' || c.method === 'Card' || c.method === 'Credit') {
        entry[c.method] += c.total;
      }
      entry.total += c.total;
      entry.profit += c.profit;
      cafeByDate.set(c.date, entry);
    }

    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = dateStrOf(new Date(cursor.year, cursor.month, i + 1));
      const entry = cafeByDate.get(date) ?? { Cash: 0, Card: 0, Credit: 0, total: 0, profit: 0 };
      return { date, ...entry };
    });
  }, [cafeTotals, cursor, daysInMonth]);

  const expensesRows = useMemo<ExpensesDayRow[]>(() => {
    const expByDate = new Map<string, { Cash: number; Card: number; total: number }>();
    for (const e of expenseTotals) {
      const entry = expByDate.get(e.date) ?? { Cash: 0, Card: 0, total: 0 };
      if (e.method === 'Cash' || e.method === 'Card') {
        entry[e.method] += e.total;
      }
      entry.total += e.total;
      expByDate.set(e.date, entry);
    }

    return Array.from({ length: daysInMonth }, (_, i) => {
      const date = dateStrOf(new Date(cursor.year, cursor.month, i + 1));
      const entry = expByDate.get(date) ?? { Cash: 0, Card: 0, total: 0 };
      return { date, ...entry };
    });
  }, [expenseTotals, cursor, daysInMonth]);

  const columns = useMemo(() => {
    if (filter === 'all') {
      const ch = createColumnHelper<AllDayRow>();
      return [
        ch.accessor('date', { header: 'Date', cell: info => formatDayLabel(info.getValue()) }),
        ch.accessor('tableSales', { header: 'Table Sales', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('cafeSales', { header: 'Cafe Sales', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('grossTotal', { header: 'Gross Revenue', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('expensesTotal', { header: 'Expenses', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('netTotal', {
          header: 'Net Profit',
          cell: info => (
            <span className={info.getValue() >= 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-destructive'}>
              {formatCurrency(info.getValue())}
            </span>
          ),
        }),
      ];
    } else if (filter === 'cafe') {
      const ch = createColumnHelper<CafeDayRow>();
      return [
        ch.accessor('date', { header: 'Date', cell: info => formatDayLabel(info.getValue()) }),
        ch.accessor('Card', { header: 'Card', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('Cash', { header: 'Cash', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('Credit', { header: 'Credit', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('total', { header: 'Total Sales', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('profit', { header: 'Cafe Profit', cell: info => formatCurrency(info.getValue()) }),
      ];
    } else if (filter === 'expenses') {
      const ch = createColumnHelper<ExpensesDayRow>();
      return [
        ch.accessor('date', { header: 'Date', cell: info => formatDayLabel(info.getValue()) }),
        ch.accessor('Card', { header: 'Card', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('Cash', { header: 'Cash', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('total', { header: 'Total Expenses', cell: info => formatCurrency(info.getValue()) }),
      ];
    } else {
      const ch = createColumnHelper<CategoryDayRow>();
      return [
        ch.accessor('date', { header: 'Date', cell: info => formatDayLabel(info.getValue()) }),
        ch.accessor('Card', { header: 'Card', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('Cash', { header: 'Cash', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('Credit', { header: 'Credit', cell: info => formatCurrency(info.getValue()) }),
        ch.accessor('total', { header: 'Total', cell: info => formatCurrency(info.getValue()) }),
      ];
    }
  }, [filter]);

  const activeTableData = useMemo<AnyDayRow[]>(() => {
    if (filter === 'all') return allRows;
    if (filter === 'cafe') return cafeRows;
    if (filter === 'expenses') return expensesRows;
    return categoryRows;
  }, [filter, allRows, cafeRows, expensesRows, categoryRows]);

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
      {/* Month Navigation & Category Filter */}
      <div className="flex flex-wrap items-center justify-between gap-4">
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
          <Button variant="outline" onClick={goToThisMonth}>
            This month
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Filter:</span>
          <Select value={filter} onValueChange={value => setFilter(value ?? 'all')}>
            <SelectTrigger className="w-56" aria-label="Filter category">
              <SelectValue placeholder="Select view" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All (Overall Summary)</SelectItem>
              {categories.map(category => (
                <SelectItem key={category.id} value={`cat-${category.id}`}>
                  {category.name}
                </SelectItem>
              ))}
              <SelectItem value="cafe">Cafe</SelectItem>
              <SelectItem value="expenses">Expenses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary Cards Overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card className="border-primary/20 bg-primary/5" data-testid="gross-revenue-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Gross Revenue</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {formatCurrency(overallFinancials.totalGrossRevenue)}
          </CardContent>
        </Card>

        <Card className="border-destructive/20 bg-destructive/5" data-testid="total-expenses-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Expenses</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-destructive">
            {formatCurrency(overallFinancials.totalExpenses)}
          </CardContent>
        </Card>

        <Card className="border-emerald-500/20 bg-emerald-500/5" data-testid="net-profit-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net Profit</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(overallFinancials.netProfit)}
          </CardContent>
        </Card>

        {categories.map(category => (
          <Card key={category.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{category.name}</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-semibold">
              {formatCurrency(categoryTotals[category.id] ?? 0)}
            </CardContent>
          </Card>
        ))}

        <Card data-testid="monthly-cafe-summary-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cafe</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <span className="text-xl font-semibold">{formatCurrency(overallFinancials.totalCafeSales)}</span>
            <span className="text-xs text-muted-foreground">profit {formatCurrency(overallFinancials.cafeProfit)}</span>
          </CardContent>
        </Card>
      </div>

      {/* Main Breakdown Table */}
      <Card>
        <CardContent className="px-0">
          {/* columns and activeTableData must derive from the same filter value -- the cast asserts it */}
          <DataTable
            columns={columns as ColumnDef<AnyDayRow>[]}
            data={activeTableData}
            isLoading={isLoading}
            loadingState={<ListSkeleton />}
            onRowClick={row => onJumpToDate(row.date)}
            rowClassName="cursor-pointer hover:bg-muted/50"
          />
        </CardContent>
      </Card>
    </div>
  );
}
