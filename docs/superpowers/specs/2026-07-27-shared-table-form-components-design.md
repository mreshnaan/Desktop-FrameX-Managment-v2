# Shared table/form components — design

> Sub-project 4 of the codebase-cleanup refactor (branch `refactor/codebase-cleanup`).
> Sub-projects 1 (web's bounded day-scoped reads), 2 (hooks + types cleanup), and 3
> (Rust backend SOLID cleanup) are complete. This is the last of the original 5-area
> audit. A new area (Session/Order paid-vs-pending status) was raised separately and
> is scoped independently, after this sub-project.

## Goal

Remove two copy-pasted UI patterns repeated across `apps/desktop` and `apps/web`:
a TanStack Table render shell (7 sites) and a react-hook-form error-display wiring
pair (8 sites, including one non-RHF outlier). Both apps keep their own copy of each
extraction (no cross-app package, per this project's existing architecture) — same
pattern already used for `groupBy` and the shared zod schemas.

## 1. `DataTable` — shared render shell for TanStack Table

Confirmed by direct file comparison: the header/row rendering JSX
(`getHeaderGroups()` → `TableHead`, `getRowModel()` → `TableCell`/`flexRender`) is
verbatim identical across all 7 call sites — only the column definitions
(`createColumnHelper`, accessors, custom `cell` renderers) and the loading/empty
messaging differ, and column definitions are genuinely per-domain (not duplicated in
substance).

**Sites:**
- `apps/desktop/src/components/views/CustomersView.tsx`
- `apps/desktop/src/components/views/MonthlyExpensesView.tsx`
- `apps/desktop/src/components/views/MonthlySalesView.tsx`
- `apps/desktop/src/components/views/UserManagementView.tsx`
- `apps/web/src/components/views/CustomersView.tsx`
- `apps/web/src/components/views/MonthlySalesView.tsx`
- `apps/web/src/components/views/UserManagementView.tsx`

**New file per app**, following the existing convention that shadcn primitives
(`table.tsx`, `field.tsx`, etc.) live in `components/ui/` and are already duplicated
per-app by design:
- `apps/desktop/src/components/ui/data-table.tsx`
- `apps/web/src/components/ui/data-table.tsx`

```tsx
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import type { ReactNode } from 'react';

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  isLoading?: boolean;
  loadingState?: ReactNode;
  emptyState?: ReactNode;
}

export function DataTable<TData>({
  columns,
  data,
  isLoading,
  loadingState,
  emptyState,
}: DataTableProps<TData>) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  if (isLoading) return <>{loadingState ?? <p>Loading…</p>}</>;
  if (data.length === 0) return <>{emptyState ?? <p>No data</p>}</>;

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map(headerGroup => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map(header => (
              <TableHead key={header.id}>
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map(row => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map(cell => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

Each of the 7 call sites drops its own `useReactTable(...)` call and the
`<Table>...</Table>` JSX block, replacing both with `<DataTable columns={columns}
data={data} isLoading={...} emptyState={...} />`. Column definitions
(`createColumnHelper`, `columnHelper.accessor(...)`) stay exactly where they are —
this is only extracting the shell that renders a `Table<TData>`, not building a
"smart table" with sorting/pagination/filtering, since none of the 7 sites use any of
that today (YAGNI: no feature is added beyond what's already there).

`isLoading`/`loadingState`/`emptyState` are optional so call sites that don't
currently branch on loading/empty state (if any) don't have to start passing them —
verified per-site during implementation, each site's existing loading/empty
messaging (e.g. desktop's plain "Loading users…" text vs a `<ListSkeleton/>`
component) is preserved by passing it through these props unchanged, not
standardized to one shared message.

## 2. `toFieldErrors` — unify RHF and manual error shapes for `FieldError`

Confirmed by direct file comparison: 7 of 8 sites repeat the same 2-line pattern per
form field —

```tsx
<Input aria-invalid={!!errors.name} ... />
<FieldError errors={errors.name ? [errors.name] : undefined} />
```

— where `errors` is react-hook-form's `FieldErrors<T>` object and `FieldError` (the
shadcn-style primitive at `components/ui/field.tsx`) takes `errors?: Array<{
message?: string }>`, not a context lookup (this codebase doesn't use shadcn's
`Form`/`FormField` pattern — established during the original form-building work).
The 8th site, `DailySalesView.tsx`, uses the same `FieldError` primitive but with a
manually-managed string error instead of an RHF `FieldErrors` entry:

```tsx
<FieldError errors={error ? [{ message: error }] : undefined} />
```

**Sites:**
- `apps/desktop/src/components/views/RateManagementView.tsx` (2 forms, 4 fields)
- `apps/desktop/src/components/views/CreditManagementView.tsx` (1 field)
- `apps/desktop/src/components/views/CustomersView.tsx` (2 fields)
- `apps/desktop/src/components/views/UserManagementView.tsx` (4 fields)
- `apps/desktop/src/components/views/DailySalesView.tsx` (manual string error, not RHF)
- `apps/desktop/src/components/auth/LoginForm.tsx` (2 fields)
- `apps/web/src/components/views/UserManagementView.tsx` (4 fields)
- `apps/web/src/components/auth/LoginForm.tsx` (2 fields)

**New file per app**, exported via each app's `lib/shared` barrel (same pattern as
`groupBy` in sub-project 1) — a plain function, not a hook, since it needs no React
state or context, just like `groupBy`:

- `apps/desktop/src/lib/shared/utils/fieldErrors.ts`
- `apps/web/src/lib/shared/utils/fieldErrors.ts`

```ts
export function toFieldErrors(
  error: { message?: string } | string | undefined,
): Array<{ message?: string }> | undefined {
  if (!error) return undefined;
  return [typeof error === 'string' ? { message: error } : error];
}
```

Every call site changes its `errors={...}` construction to `toFieldErrors(...)`, and
its adjacent `aria-invalid={!!...}` to reuse the same call:

```tsx
<Input aria-invalid={!!toFieldErrors(errors.name)} ... />
<FieldError errors={toFieldErrors(errors.name)} />
```

`DailySalesView.tsx` becomes `toFieldErrors(error)` (its own local `error: string`
variable) — no special-casing needed, since `toFieldErrors` accepts either shape
directly. This is why the union-typed helper (rather than an RHF-only helper plus a
separate string-only helper) was chosen: one function covers all 8 sites with no
site needing to know which shape it's holding.

## Testing

No behavior change is intended — this is a pure structural extraction of already-
duplicated render/wiring code. Verification is:

- `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web exec
  tsc -b` (catches any call site that didn't fully switch over, or a column-def type
  mismatch against `DataTable`'s generic `ColumnDef<TData>[]`).
- Full desktop e2e suite and full web e2e suite, since these are view-composition
  changes with no unit-test coverage today (per this project's existing testing
  convention — view composition is covered by e2e, not component-level tests). In
  particular any spec touching Customers, Monthly Sales, Monthly Expenses, User
  Management, Rate Management, Credit Management, Daily Sales, or login, since those
  are the views whose table/form rendering changes here.
- Manual visual check (`pnpm dev` on both apps) that each table's loading/empty
  states still show their original per-site message/skeleton, and that each form's
  validation errors still render in the same place with the same text as before.
