# Shared Table/Form Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove two copy-pasted UI patterns across `apps/desktop` and `apps/web` — a
TanStack Table render shell (7 sites) and a react-hook-form/`FieldError` wiring pair
(8 sites) — with zero behavior change.

**Architecture:** Four independent tasks, one per (app × concern) pair. Each creates
one new shared file and migrates that app's call sites for that concern. No cross-app
package — each app gets its own copy of `DataTable` and `toFieldErrors`, matching the
existing `groupBy` precedent.

**Tech Stack:** React, TypeScript, `@tanstack/react-table`, `react-hook-form`, Vite (desktop + web), Playwright (e2e).

## Global Constraints

- No behavior change: same columns, same data, same loading/empty messaging per
  site, same validation error text and placement. Pure structural extraction.
- No `any` in new code (this project's standing rule) — `DataTable`'s columns prop is
  `ColumnDef<TData>[]`, not `ColumnDef<TData, any>[]`.
- No sorting/pagination/filtering added to `DataTable` — none of the 7 sites use any
  of that today; don't add capability beyond what's being extracted.
- `toFieldErrors` must accept `{ message?: string } | string | null | undefined` (the
  `| null` exists specifically for `DailySalesView.tsx`'s manually-managed error,
  which is typed `string | null`).
- Verify each task with `tsc -b` for the touched app, plus the app's e2e suite for
  every view touched in that task.

---

### Task 1: Desktop `DataTable` — create component, migrate 4 desktop table sites

**Files:**
- Create: `apps/desktop/src/components/ui/data-table.tsx`
- Modify: `apps/desktop/src/components/views/CustomersView.tsx`
- Modify: `apps/desktop/src/components/views/MonthlyExpensesView.tsx`
- Modify: `apps/desktop/src/components/views/MonthlySalesView.tsx`
- Modify: `apps/desktop/src/components/views/UserManagementView.tsx`

**Interfaces:**
- Consumes: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`
  from `./table` (unchanged).
- Produces: `DataTable<TData>({ columns, data, isLoading?, loadingState?, emptyState?,
  onRowClick?, rowClassName? })`, a default export from a named export (see below),
  imported by all 4 modified views (and, in Task 2, both apps' remaining 3 web
  views — this file is desktop-only, web gets its own copy in Task 2).

- [ ] **Step 1: Create `apps/desktop/src/components/ui/data-table.tsx`**

```tsx
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  isLoading?: boolean;
  loadingState?: ReactNode;
  emptyState?: ReactNode;
  onRowClick?: (row: TData) => void;
  rowClassName?: string;
}

export function DataTable<TData>({
  columns,
  data,
  isLoading,
  loadingState,
  emptyState,
  onRowClick,
  rowClassName,
}: DataTableProps<TData>) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  if (isLoading) return <>{loadingState ?? <p className="px-4 text-sm text-muted-foreground">Loading…</p>}</>;
  if (data.length === 0) return <>{emptyState ?? <p className="px-4 text-sm text-muted-foreground">No data</p>}</>;

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
          <TableRow
            key={row.id}
            className={onRowClick ? rowClassName : undefined}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
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
  );
}
```

- [ ] **Step 2: Migrate `apps/desktop/src/components/views/CustomersView.tsx`**

Change the imports: remove `useReactTable, getCoreRowModel, flexRender` from the
`@tanstack/react-table` import (keep `createColumnHelper`), remove the
`Table, TableBody, TableCell, TableHead, TableHeader, TableRow` import from
`@/components/ui/table`, and add:

```ts
import { DataTable } from '@/components/ui/data-table';
```

Delete the `const table = useReactTable({...})` block (lines 72-76). Replace the
table-rendering block:

```tsx
          {customers.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">
              No customers yet. Add a customer above to enable credit tracking.
            </p>
          ) : (
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
          )}
```

with:

```tsx
          <DataTable
            columns={columns}
            data={customers}
            emptyState={
              <p className="px-4 text-sm text-muted-foreground">
                No customers yet. Add a customer above to enable credit tracking.
              </p>
            }
          />
```

- [ ] **Step 3: Migrate `apps/desktop/src/components/views/MonthlyExpensesView.tsx`**

Remove `useReactTable, getCoreRowModel, flexRender` from the `@tanstack/react-table`
import (keep `createColumnHelper`), remove the `Table, TableBody, TableCell,
TableHead, TableHeader, TableRow` import, add:

```ts
import { DataTable } from '@/components/ui/data-table';
```

Delete the `const table = useReactTable({...})` block (lines 79-83). Replace:

```tsx
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
```

with:

```tsx
          <DataTable
            columns={columns}
            data={rows}
            isLoading={isLoading}
            loadingState={<ListSkeleton />}
            onRowClick={row => onJumpToDate(row.date)}
            rowClassName="cursor-pointer"
          />
```

- [ ] **Step 4: Migrate `apps/desktop/src/components/views/MonthlySalesView.tsx`**

Remove `useReactTable, getCoreRowModel, flexRender` from the `@tanstack/react-table`
import (keep `createColumnHelper`), remove the `Table, TableBody, TableCell,
TableHead, TableHeader, TableRow` import, add:

```ts
import { DataTable } from '@/components/ui/data-table';
```

Delete the `const table = useReactTable<AnyDayRow>({...})` block (lines 277-281) —
this includes the pre-existing `columns: columns as any` cast, which is being removed
along with the whole block, not preserved (the cast was a workaround for
`useReactTable`'s own generic inference across 4 possible row-shape unions; `DataTable`
takes the same `columns` value as a plain prop with no generic-inference step of its
own, so passing `columns={columns}` directly needs no cast — verify this compiles
cleanly in Step 5's `tsc -b`; if it doesn't, add back an explicit
`columns={columns as ColumnDef<AnyDayRow>[]}` at the call site only, not inside
`DataTable` itself, since `DataTable`'s own signature must stay `any`-free per the
Global Constraints).

Replace:

```tsx
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
                    className="cursor-pointer hover:bg-muted/50"
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
```

with:

```tsx
          <DataTable
            columns={columns}
            data={activeTableData}
            isLoading={isLoading}
            loadingState={<ListSkeleton />}
            onRowClick={row => onJumpToDate(row.date)}
            rowClassName="cursor-pointer hover:bg-muted/50"
          />
```

- [ ] **Step 5: Migrate `apps/desktop/src/components/views/UserManagementView.tsx`**

Remove `useReactTable, getCoreRowModel, flexRender` from the `@tanstack/react-table`
import (keep `createColumnHelper`), remove the `Table, TableBody, TableCell,
TableHead, TableHeader, TableRow` import, add:

```ts
import { DataTable } from '@/components/ui/data-table';
```

Delete the `const table = useReactTable({...})` block (lines 98-102). Replace:

```tsx
          {usersQuery.isLoading ? (
            <ListSkeleton />
          ) : !usersQuery.data || usersQuery.data.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No users yet.</p>
          ) : (
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
          )}
```

with:

```tsx
          <DataTable
            columns={columns}
            data={usersQuery.data ?? []}
            isLoading={usersQuery.isLoading}
            loadingState={<ListSkeleton />}
            emptyState={<p className="px-4 text-sm text-muted-foreground">No users yet.</p>}
          />
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors. **Correction found during Task 1's review:** the assumption that
only `MonthlySalesView.tsx` would need a cast was wrong — under this project's
`strict: true` config, `ColumnDef<TData>[]` rejects any column-helper array whose
`cell`/`accessorFn` types aren't uniform, which affects all 4 sites, not just the one
with a pre-existing `as any`. Expect to add `columns={columns as ColumnDef<RowType>[]}`
(with each site's actual row type) at all 4 `DataTable` call sites, not just
`MonthlySalesView.tsx`'s.

Run (from `apps/desktop`): `pnpm dev` and manually click through Customers, Monthly
Expenses, Monthly Sales (all 4 filter options), and User Management — confirm each
table renders identically to before (same columns, same loading/empty states), and
that clicking a Monthly Expenses/Monthly Sales row still jumps to that date in Daily
Sales.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/ui/data-table.tsx apps/desktop/src/components/views/CustomersView.tsx apps/desktop/src/components/views/MonthlyExpensesView.tsx apps/desktop/src/components/views/MonthlySalesView.tsx apps/desktop/src/components/views/UserManagementView.tsx
git commit -m "refactor(desktop): extract DataTable render shell, migrate 4 table views"
```

---

### Task 2: Web `DataTable` — create component, migrate 3 web table sites

**Files:**
- Create: `apps/web/src/components/ui/data-table.tsx`
- Modify: `apps/web/src/components/views/CustomersView.tsx`
- Modify: `apps/web/src/components/views/MonthlySalesView.tsx`
- Modify: `apps/web/src/components/views/UserManagementView.tsx`

**Interfaces:**
- Produces: `DataTable<TData>({ columns, data, isLoading?, loadingState?,
  emptyState?, onRowClick?, rowClassName? })` — identical shape to Task 1's desktop
  version, since web has no cross-app package to share it from.

- [ ] **Step 1: Create `apps/web/src/components/ui/data-table.tsx`**

Identical content to Task 1 Step 1 (`apps/desktop/src/components/ui/data-table.tsx`) —
copy verbatim, since both apps use the same shadcn `table.tsx` primitives and the
same `@tanstack/react-table` version.

- [ ] **Step 2: Migrate `apps/web/src/components/views/CustomersView.tsx`**

Remove `useReactTable, getCoreRowModel, flexRender` from the `@tanstack/react-table`
import (keep `createColumnHelper`), remove the `Table, TableBody, TableCell,
TableHead, TableHeader, TableRow` import, add:

```ts
import { DataTable } from '@/components/ui/data-table';
```

Delete the `const table = useReactTable({...})` block (lines 33-37). Replace:

```tsx
          {customers.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No customers yet.</p>
          ) : (
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
          )}
```

with:

```tsx
          <DataTable
            columns={columns}
            data={customers}
            emptyState={<p className="px-4 text-sm text-muted-foreground">No customers yet.</p>}
          />
```

- [ ] **Step 3: Migrate `apps/web/src/components/views/MonthlySalesView.tsx`**

Remove `useReactTable, getCoreRowModel, flexRender` from the `@tanstack/react-table`
import (keep `createColumnHelper`), remove the `Table, TableBody, TableCell,
TableHead, TableHeader, TableRow` import, add:

```ts
import { DataTable } from '@/components/ui/data-table';
```

Delete the `const table = useReactTable<AnyDayRow>({...})` block (lines 308-312) —
same `columns: columns as any` removal as Task 1 Step 4. **Task 1's review found
`ColumnDef<TData>[]` needs a call-site cast at every site with a non-uniform column
array under this project's `strict: true` config, not just this one** — expect to add
`columns={columns as ColumnDef<AnyDayRow>[]}` here, and likely at
`CustomersView.tsx`/`UserManagementView.tsx` below too (with their own row types),
confirmed by `tsc -b` in Step 5.

Replace:

```tsx
          {isLoading ? (
            <p className="px-4 text-sm text-muted-foreground">Loading monthly data…</p>
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
                    className="cursor-pointer hover:bg-muted/50"
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
```

with:

```tsx
          <DataTable
            columns={columns}
            data={activeTableData}
            isLoading={isLoading}
            loadingState={<p className="px-4 text-sm text-muted-foreground">Loading monthly data…</p>}
            onRowClick={row => onJumpToDate(row.date)}
            rowClassName="cursor-pointer hover:bg-muted/50"
          />
```

- [ ] **Step 4: Migrate `apps/web/src/components/views/UserManagementView.tsx`**

Remove `useReactTable, getCoreRowModel, flexRender` from the `@tanstack/react-table`
import (keep `createColumnHelper`), remove the `Table, TableBody, TableCell,
TableHead, TableHeader, TableRow` import, add:

```ts
import { DataTable } from '@/components/ui/data-table';
```

Delete the `const table = useReactTable({...})` block (lines 97-101). Replace:

```tsx
          {usersQuery.isLoading ? (
            <p className="px-4 text-sm text-muted-foreground">Loading users…</p>
          ) : !usersQuery.data || usersQuery.data.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No users yet.</p>
          ) : (
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
          )}
```

with:

```tsx
          <DataTable
            columns={columns}
            data={usersQuery.data ?? []}
            isLoading={usersQuery.isLoading}
            loadingState={<p className="px-4 text-sm text-muted-foreground">Loading users…</p>}
            emptyState={<p className="px-4 text-sm text-muted-foreground">No users yet.</p>}
          />
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @cue-room/web exec tsc -b`
Expected: no errors (same cast caveat as Task 1 Step 6 for `MonthlySalesView.tsx`, if needed).

Run (from `apps/web`): `pnpm dev` and manually click through Customers, Monthly Sales
(all filter options), and User Management — confirm each table renders identically to
before, and clicking a Monthly Sales row still jumps to that date.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/data-table.tsx apps/web/src/components/views/CustomersView.tsx apps/web/src/components/views/MonthlySalesView.tsx apps/web/src/components/views/UserManagementView.tsx
git commit -m "refactor(web): extract DataTable render shell, migrate 3 table views"
```

---

### Task 3: Desktop `toFieldErrors` — create helper, migrate 6 desktop form sites

**Files:**
- Create: `apps/desktop/src/lib/shared/utils/fieldErrors.ts`
- Modify: `apps/desktop/src/lib/shared/index.ts`
- Modify: `apps/desktop/src/components/views/RateManagementView.tsx`
- Modify: `apps/desktop/src/components/views/CreditManagementView.tsx`
- Modify: `apps/desktop/src/components/views/CustomersView.tsx`
- Modify: `apps/desktop/src/components/views/UserManagementView.tsx`
- Modify: `apps/desktop/src/components/views/DailySalesView.tsx`
- Modify: `apps/desktop/src/components/auth/LoginForm.tsx`

**Interfaces:**
- Produces: `toFieldErrors(error: { message?: string } | string | null | undefined):
  Array<{ message?: string }> | undefined`, exported from `@/lib/shared`, imported by
  all 6 modified files.

- [ ] **Step 1: Create `apps/desktop/src/lib/shared/utils/fieldErrors.ts`**

```ts
export function toFieldErrors(
  error: { message?: string } | string | null | undefined,
): Array<{ message?: string }> | undefined {
  if (!error) return undefined;
  return [typeof error === 'string' ? { message: error } : error];
}
```

- [ ] **Step 2: Add the export to `apps/desktop/src/lib/shared/index.ts`**

Add:

```ts
export * from './utils/fieldErrors.js';
```

- [ ] **Step 3: Migrate `apps/desktop/src/components/views/RateManagementView.tsx`**

Add `toFieldErrors` to the existing `@/lib/shared` import (already imports
`TimeRateSchema, FrameRateSchema, type TimeRateInput, type FrameRateInput` from
there):

```ts
import { TimeRateSchema, FrameRateSchema, toFieldErrors, type TimeRateInput, type FrameRateInput } from '@/lib/shared';
```

In `TimeRateCard`, replace:

```tsx
                aria-invalid={!!errors.hour}
                {...register('hour')}
                onBlur={handleSubmit(onSubmit)}
              />
              <FieldError errors={errors.hour ? [errors.hour] : undefined} />
```

with:

```tsx
                aria-invalid={!!toFieldErrors(errors.hour)}
                {...register('hour')}
                onBlur={handleSubmit(onSubmit)}
              />
              <FieldError errors={toFieldErrors(errors.hour)} />
```

and replace:

```tsx
                aria-invalid={!!errors.half}
                {...register('half')}
                onBlur={handleSubmit(onSubmit)}
              />
              <FieldError errors={errors.half ? [errors.half] : undefined} />
```

with:

```tsx
                aria-invalid={!!toFieldErrors(errors.half)}
                {...register('half')}
                onBlur={handleSubmit(onSubmit)}
              />
              <FieldError errors={toFieldErrors(errors.half)} />
```

In `FrameRateCard`, replace:

```tsx
              aria-invalid={!!errors.value}
              {...register('value')}
              onBlur={handleSubmit(onSubmit)}
            />
            <FieldError errors={errors.value ? [errors.value] : undefined} />
```

with:

```tsx
              aria-invalid={!!toFieldErrors(errors.value)}
              {...register('value')}
              onBlur={handleSubmit(onSubmit)}
            />
            <FieldError errors={toFieldErrors(errors.value)} />
```

- [ ] **Step 4: Migrate `apps/desktop/src/components/views/CreditManagementView.tsx`**

Add `toFieldErrors` to the existing `@/lib/shared` import:

```ts
import {
  CreditDraftSchema,
  formatCurrency,
  todayStr,
  toFieldErrors,
  type Customer,
  type CreditDraft,
  type CreditEntry,
} from '@/lib/shared';
```

Replace:

```tsx
              aria-invalid={!!errors.amount}
              {...register('amount')}
            />
            <FieldError errors={errors.amount ? [errors.amount] : undefined} />
```

with:

```tsx
              aria-invalid={!!toFieldErrors(errors.amount)}
              {...register('amount')}
            />
            <FieldError errors={toFieldErrors(errors.amount)} />
```

- [ ] **Step 5: Migrate `apps/desktop/src/components/views/CustomersView.tsx`**

Add `toFieldErrors` to the existing `@/lib/shared` import (already imports
`CustomerDraftSchema, type Customer`):

```ts
import { CustomerDraftSchema, toFieldErrors, type Customer } from '@/lib/shared';
```

Replace:

```tsx
                  aria-invalid={!!errors.name}
                  {...register('name')}
                />
                <FieldError errors={errors.name ? [errors.name] : undefined} />
```

with:

```tsx
                  aria-invalid={!!toFieldErrors(errors.name)}
                  {...register('name')}
                />
                <FieldError errors={toFieldErrors(errors.name)} />
```

and replace:

```tsx
                  aria-invalid={!!errors.phone}
                  {...register('phone')}
                />
                <FieldError errors={errors.phone ? [errors.phone] : undefined} />
```

with:

```tsx
                  aria-invalid={!!toFieldErrors(errors.phone)}
                  {...register('phone')}
                />
                <FieldError errors={toFieldErrors(errors.phone)} />
```

- [ ] **Step 6: Migrate `apps/desktop/src/components/views/UserManagementView.tsx`**

Add `toFieldErrors` to the existing `@/lib/shared` import (already imports
`CreateUserSchema, type CreateUserInput`):

```ts
import { CreateUserSchema, toFieldErrors, type CreateUserInput } from '@/lib/shared';
```

Replace each of the 4 field wirings:

```tsx
                  aria-invalid={!!errors.name}
                  {...register('name')}
                />
                <FieldError errors={errors.name ? [errors.name] : undefined} />
```
→
```tsx
                  aria-invalid={!!toFieldErrors(errors.name)}
                  {...register('name')}
                />
                <FieldError errors={toFieldErrors(errors.name)} />
```

```tsx
                  aria-invalid={!!errors.username}
                  {...register('username')}
                />
                <FieldError errors={errors.username ? [errors.username] : undefined} />
```
→
```tsx
                  aria-invalid={!!toFieldErrors(errors.username)}
                  {...register('username')}
                />
                <FieldError errors={toFieldErrors(errors.username)} />
```

```tsx
                    <PinInput id="user-pin" value={field.value} onChange={field.onChange} aria-invalid={!!errors.pin} />
                  )}
                />
                <FieldError errors={errors.pin ? [errors.pin] : undefined} />
```
→
```tsx
                    <PinInput id="user-pin" value={field.value} onChange={field.onChange} aria-invalid={!!toFieldErrors(errors.pin)} />
                  )}
                />
                <FieldError errors={toFieldErrors(errors.pin)} />
```

```tsx
                      <SelectTrigger id="user-role" aria-invalid={!!errors.roleId}>
```
→
```tsx
                      <SelectTrigger id="user-role" aria-invalid={!!toFieldErrors(errors.roleId)}>
```

and:

```tsx
                <FieldError errors={errors.roleId ? [errors.roleId] : undefined} />
```
→
```tsx
                <FieldError errors={toFieldErrors(errors.roleId)} />
```

- [ ] **Step 7: Migrate `apps/desktop/src/components/views/DailySalesView.tsx`**

Add `toFieldErrors` to the existing `@/lib/shared` import:

```ts
import {
  SessionSchema,
  formatCurrency,
  todayStr,
  nowTimeStr,
  addMinutesToTime,
  durationMinutes,
  groupBy,
  toFieldErrors,
  type Session,
  type Customer,
  type Billing,
} from '@/lib/shared';
```

Replace:

```tsx
      <FieldError errors={error ? [{ message: error }] : undefined} />
```

with:

```tsx
      <FieldError errors={toFieldErrors(error)} />
```

- [ ] **Step 8: Migrate `apps/desktop/src/components/auth/LoginForm.tsx`**

Add `toFieldErrors` to the existing `@/lib/shared` import:

```ts
import { LoginSchema, toFieldErrors, type LoginInput } from '@/lib/shared';
```

Replace:

```tsx
                  aria-invalid={!!errors.username}
                  {...register('username')}
                />
                <FieldError errors={errors.username ? [errors.username] : undefined} />
```

with:

```tsx
                  aria-invalid={!!toFieldErrors(errors.username)}
                  {...register('username')}
                />
                <FieldError errors={toFieldErrors(errors.username)} />
```

and replace:

```tsx
                      value={field.value}
                      onChange={field.onChange}
                      aria-invalid={!!errors.pin}
                    />
                  )}
                />
                <FieldError errors={errors.pin ? [errors.pin] : undefined} />
```

with:

```tsx
                      value={field.value}
                      onChange={field.onChange}
                      aria-invalid={!!toFieldErrors(errors.pin)}
                    />
                  )}
                />
                <FieldError errors={toFieldErrors(errors.pin)} />
```

- [ ] **Step 9: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev` and manually trigger a validation error in each
of the 6 migrated forms (Rate Management ×2 fields, Credit Management, Customers,
User Management, login) plus Daily Sales' quick-duration error path — confirm each
error still displays in the same place with the same text as before.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/lib/shared/utils/fieldErrors.ts apps/desktop/src/lib/shared/index.ts apps/desktop/src/components/views/RateManagementView.tsx apps/desktop/src/components/views/CreditManagementView.tsx apps/desktop/src/components/views/CustomersView.tsx apps/desktop/src/components/views/UserManagementView.tsx apps/desktop/src/components/views/DailySalesView.tsx apps/desktop/src/components/auth/LoginForm.tsx
git commit -m "refactor(desktop): extract toFieldErrors helper, migrate 6 form call sites"
```

---

### Task 4: Web `toFieldErrors` — create helper, migrate 2 web form sites

**Files:**
- Create: `apps/web/src/lib/shared/utils/fieldErrors.ts`
- Modify: `apps/web/src/lib/shared/index.ts`
- Modify: `apps/web/src/components/views/UserManagementView.tsx`
- Modify: `apps/web/src/components/auth/LoginForm.tsx`

**Interfaces:**
- Produces: `toFieldErrors(...)` — identical shape to Task 3's desktop version.

- [ ] **Step 1: Create `apps/web/src/lib/shared/utils/fieldErrors.ts`**

Identical content to Task 3 Step 1 — copy verbatim.

- [ ] **Step 2: Add the export to `apps/web/src/lib/shared/index.ts`**

Add:

```ts
export * from './utils/fieldErrors.js';
```

- [ ] **Step 3: Migrate `apps/web/src/components/views/UserManagementView.tsx`**

Add `toFieldErrors` to the existing `@/lib/shared` import (already imports
`CreateUserSchema, type CreateUserInput`):

```ts
import { CreateUserSchema, toFieldErrors, type CreateUserInput } from '@/lib/shared';
```

Apply the same 4 field-wiring replacements as Task 3 Step 6 (`errors.name`,
`errors.username`, `errors.pin`, `errors.roleId`) — identical before/after code,
since this file is near-byte-identical to its desktop counterpart.

- [ ] **Step 4: Migrate `apps/web/src/components/auth/LoginForm.tsx`**

Add `toFieldErrors` to the existing `@/lib/shared` import:

```ts
import { LoginSchema, toFieldErrors, type LoginInput } from '@/lib/shared';
```

Apply the same 2 field-wiring replacements as Task 3 Step 8 (`errors.username`,
`errors.pin`) — identical before/after code to the desktop `LoginForm.tsx`.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @cue-room/web exec tsc -b`
Expected: no errors.

Run (from `apps/web`): `pnpm dev`, log in with an invalid username/PIN and confirm the
error still displays correctly; as Admin/Owner, trigger a User Management validation
error and confirm the same.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/shared/utils/fieldErrors.ts apps/web/src/lib/shared/index.ts apps/web/src/components/views/UserManagementView.tsx apps/web/src/components/auth/LoginForm.tsx
git commit -m "refactor(web): extract toFieldErrors helper, migrate 2 form call sites"
```

---

## Final verification (after all 4 tasks)

- [ ] Run `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web exec tsc -b`
  Expected: both clean.
- [ ] Run the full desktop e2e suite (`pnpm --filter @cue-room/desktop test:e2e`),
  in particular any spec touching Customers, Monthly Sales, Monthly Expenses, User
  Management, Rate Management, Credit Management, Daily Sales, or login.
- [ ] Run the full web e2e suite (`pnpm --filter @cue-room/web test:e2e`), in
  particular any spec touching Customers, Monthly Sales, User Management, or login.
- [ ] Manual check on both apps (`pnpm dev`): every migrated table's loading/empty
  state still shows its original message/skeleton, and every migrated form's
  validation errors still render in the same place with the same text.
