# useMutation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every hand-rolled mutate-then-invalidate call (hook-level via `useInvalidateAfter`, and 10 ad-hoc view-level sites) with `@tanstack/react-query`'s `useMutation`, across both apps, with zero behavior change.

**Architecture:** Nine sequential, mostly-independent tasks. Tasks 1-6 each migrate one desktop data hook plus its direct consuming view(s). Task 7 deletes `useInvalidateAfter.ts` once nothing imports it. Task 8 migrates desktop's 4 ad-hoc view-level admin screens (no shared data hook backs these — each gets its own inline `useMutation` calls, keeping its existing callback-prop architecture). Task 9 migrates web's one ad-hoc site.

**Tech Stack:** React, TypeScript, `@tanstack/react-query`, react-hook-form, Playwright (e2e).

## Global Constraints

- No behavior change: same mutation calls, same invalidated query keys, same success/failure UI outcomes.
- **`mutate`/`mutateAsync` take exactly one argument.** Every multi-positional-arg function being converted (`checkout(items, method, customerId)`, `adjustCustomer(customerId, date, type, amount)`, `updateSession(id, patch)`, `updateExpense(id, patch)`) becomes a single `{ ... }` object parameter, at both `mutationFn` and every call site.
- Hooks return the full `UseMutationResult` object per mutation (e.g. `addCustomer` is now `UseMutationResult<Customer, Error, {...}>`, not a function). Call sites use `.mutate(...)` (fire-and-forget) or `await .mutateAsync(...)` (when the caller chains on completion).
- Where a mutation is threaded down to a child component as a callback prop (`ProductManagementView`'s `onCreated`/`onSave`/`onAdjustStock`, `DailySalesView`'s `updateSession`/`deleteSession`, `ExpensesView`'s `updateExpense`/`deleteExpense`), the parent wraps the mutation in a thin closure matching the child's **existing** prop type exactly (e.g. `(name: string) => Promise<void>`) — the child component itself is not modified, since it has no existing pending/error UI to preserve or improve for that prop.
- Verify each task with `pnpm --filter @cue-room/desktop exec tsc -b` (Tasks 1-6, 8) or `pnpm --filter @cue-room/web exec tsc -b` (Task 9) before committing.

---

### Task 1: `useCustomers.ts` + `CustomersView.tsx` + `CreditManagementView.tsx`

**Files:**
- Modify: `apps/desktop/src/lib/hooks/useCustomers.ts`
- Modify: `apps/desktop/src/components/views/CustomersView.tsx`
- Modify: `apps/desktop/src/components/views/CreditManagementView.tsx`

**Interfaces:**
- Consumes: `commands.createCustomer`, `commands.deleteCustomer`, `commands.createCreditEntry` (unchanged).
- Produces: `useCustomers()` returns `{ customers, history, addCustomer, deleteCustomer, adjustCustomer, balanceFor }` where `addCustomer`/`deleteCustomer`/`adjustCustomer` are now `UseMutationResult` objects instead of functions.

- [ ] **Step 1: Replace `useCustomers.ts` in full**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type CustomerHistoryRow } from '../tauri/commands';

// Balances are pre-aggregated in SQLite via get_customer_balances --
// balanceFor is just a direct property lookup, no client-side computation.
export function useCustomers() {
  const qc = useQueryClient();

  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: () => commands.listCustomers(),
  });

  const balancesQuery = useQuery({
    queryKey: ['customer-balances'],
    queryFn: () => commands.getCustomerBalances(),
  });

  const historyQuery = useQuery({
    queryKey: ['credit-entries'],
    queryFn: () => commands.listCreditEntries(),
  });

  const addCustomer = useMutation({
    mutationFn: (input: { name: string; phone?: string }) =>
      commands.createCustomer(input.name, input.phone ?? ''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer-balances'] });
    },
  });

  const deleteCustomer = useMutation({
    mutationFn: (id: string) => commands.deleteCustomer(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer-balances'] });
    },
  });

  const adjustCustomer = useMutation({
    mutationFn: (input: {
      customerId: string;
      date: string;
      type: 'CREDIT_GIVEN' | 'PAYMENT_RECEIVED';
      amount: number;
    }) => commands.createCreditEntry(input.customerId, input.date, input.type, input.amount),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit-entries'] });
      qc.invalidateQueries({ queryKey: ['customer-balances'] });
    },
  });

  const balances: Record<string, number> = balancesQuery.data ?? {};

  function balanceFor(customerId: string): number {
    return balances[customerId] ?? 0;
  }

  return {
    customers: customersQuery.data ?? [],
    history: historyQuery.data ?? [],
    addCustomer,
    deleteCustomer,
    adjustCustomer,
    balanceFor,
  };
}

export type { CustomerHistoryRow };
```

- [ ] **Step 2: Migrate `CustomersView.tsx`**

Replace (around line 26-28):

```tsx
  async function onSubmit(data: { name: string; phone?: string }) {
    await addCustomer({ name: data.name, phone: data.phone || '' });
    reset();
  }
```

with:

```tsx
  async function onSubmit(data: { name: string; phone?: string }) {
    await addCustomer.mutateAsync({ name: data.name, phone: data.phone || '' });
    reset();
  }
```

Replace (around line 50):

```tsx
            onClick={() => deleteCustomer(info.row.original.id)}
```

with:

```tsx
            onClick={() => deleteCustomer.mutate(info.row.original.id)}
```

Update the submit button's `disabled` prop (currently `disabled={isSubmitting}` from RHF's `formState`) to also reflect the mutation: `disabled={isSubmitting || addCustomer.isPending}`.

- [ ] **Step 3: Migrate `CreditManagementView.tsx`**

Replace (around line 86, 91):

```tsx
    await adjustCustomer(customer.id, todayStr(), 'CREDIT_GIVEN', data.amount);
```
```tsx
    await adjustCustomer(customer.id, todayStr(), 'PAYMENT_RECEIVED', data.amount);
```

with:

```tsx
    await adjustCustomer.mutateAsync({ customerId: customer.id, date: todayStr(), type: 'CREDIT_GIVEN', amount: data.amount });
```
```tsx
    await adjustCustomer.mutateAsync({ customerId: customer.id, date: todayStr(), type: 'PAYMENT_RECEIVED', amount: data.amount });
```

The "Give credit"/"Record payment" buttons currently disable via RHF's `isSubmitting` — add `|| adjustCustomer.isPending` to both buttons' `disabled` expressions.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, add a customer, delete a customer, give/record credit for a customer — confirm all three still work and the balance/list update afterward (same as before).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/hooks/useCustomers.ts apps/desktop/src/components/views/CustomersView.tsx apps/desktop/src/components/views/CreditManagementView.tsx
git commit -m "refactor(desktop): migrate useCustomers to useMutation"
```

---

### Task 2: `useSessions.ts` + `DailySalesView.tsx`

**Files:**
- Modify: `apps/desktop/src/lib/hooks/useSessions.ts`
- Modify: `apps/desktop/src/components/views/DailySalesView.tsx`

**Interfaces:**
- Produces: `useSessions(date)` returns `{ sessions, isLoading, addSession, updateSession, deleteSession }` where the three mutation fields are now `UseMutationResult` objects.

- [ ] **Step 1: Replace `useSessions.ts` in full**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands } from '../tauri/commands';
import type { Session } from '../shared/schemas/session.schema';

export function useSessions(date: string) {
  const qc = useQueryClient();
  const key = ['sessions', date];

  const query = useQuery({
    queryKey: key,
    queryFn: () => commands.listSessionsForDate(date),
  });

  const addSession = useMutation({
    mutationFn: (input: { stationId: string; categoryId: string; billingType: 'time' | 'frame' }) =>
      commands.createSession(input.stationId, input.categoryId, input.billingType, date),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const updateSession = useMutation({
    mutationFn: (input: { id: string; patch: Partial<Session> }) =>
      commands.updateSession(input.id, {
        start: input.patch.start,
        end: input.patch.end,
        amount: input.patch.amount,
        method: input.patch.method,
        customerId: input.patch.customerId,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const deleteSession = useMutation({
    mutationFn: (id: string) => commands.deleteSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return { sessions: query.data ?? [], isLoading: query.isLoading, addSession, updateSession, deleteSession };
}
```

- [ ] **Step 2: Migrate `DailySalesView.tsx`**

Update the `UpdateSessionFn`/`DeleteSessionFn` type aliases (around line 48-50) — these describe the prop types passed down to the row component, which itself is NOT being changed (no existing pending/error UI at the row level to preserve), so keep them as plain `Promise<void>`-returning functions:

```ts
type UpdateSessionFn = (id: string, patch: Partial<Session>) => Promise<void>;
type DeleteSessionFn = (id: string) => Promise<void>;
```

(unchanged — no edit needed here, just confirming the prop type stays this shape.)

Where `DailySalesView` currently passes `updateSession`/`deleteSession` down to the row component as props, wrap the mutation objects in thin closures matching that same type. Find the prop-passing call site (search for where the row component is rendered with `updateSession={updateSession}` or similar) and change it to:

```tsx
updateSession={(id, patch) => updateSession.mutateAsync({ id, patch }).then(() => undefined)}
deleteSession={id => deleteSession.mutateAsync(id).then(() => undefined)}
```

Where `addSession` is called directly (around line 234):

```tsx
onClick={() => addSession(station.id, category.id, category.billingType)}
```

becomes:

```tsx
onClick={() => addSession.mutate({ stationId: station.id, categoryId: category.id, billingType: category.billingType })}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, add a session, edit its start/end/amount/method, delete a session — confirm all three still work identically (same list refresh, same quick-duration/extend buttons still function since those call `commit()` which calls the wrapped `updateSession` prop).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/hooks/useSessions.ts apps/desktop/src/components/views/DailySalesView.tsx
git commit -m "refactor(desktop): migrate useSessions to useMutation"
```

---

### Task 3: `useExpenses.ts` + `ExpensesView.tsx`

**Files:**
- Modify: `apps/desktop/src/lib/hooks/useExpenses.ts`
- Modify: `apps/desktop/src/components/views/ExpensesView.tsx`

**Interfaces:**
- Produces: `useExpenses(date)` returns `{ expenses, addExpense, updateExpense, deleteExpense }` where the three mutation fields are now `UseMutationResult` objects. `useExpensesBetween` (a read-only query, no mutations) is untouched.

- [ ] **Step 1: Replace `useExpenses.ts`'s `useExpenses` function** (leave `useExpensesBetween`, lines 40-46, unchanged)

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands } from '../tauri/commands';
import type { Expense } from '../shared/schemas/expense.schema';

export function useExpenses(date: string) {
  const qc = useQueryClient();
  const key = ['expenses', date];

  const query = useQuery({
    queryKey: key,
    queryFn: () => commands.listExpensesForDate(date),
  });

  // Broader than `key` alone: a backdated expense lands on a different day's
  // cache than the one currently being viewed, so addExpense invalidates
  // every cached expenses-day query instead of just this one.
  const addExpense = useMutation({
    mutationFn: (customDate?: string) => commands.createExpense(customDate ?? date),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const updateExpense = useMutation({
    mutationFn: (input: { id: string; patch: Partial<Expense> }) =>
      commands.updateExpense(input.id, input.patch.description, input.patch.amount, input.patch.method),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const deleteExpense = useMutation({
    mutationFn: (id: string) => commands.deleteExpense(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return { expenses: query.data ?? [], addExpense, updateExpense, deleteExpense };
}
```

- [ ] **Step 2: Migrate `ExpensesView.tsx`**

Keep the `UpdateExpenseFn`/`DeleteExpenseFn` type aliases (around line 25-26) unchanged — same reasoning as Task 2's `DailySalesView` row props (no existing pending/error UI at the row level).

Where `addExpense` is called directly (around line 35):

```tsx
    await addExpense(backdateTo || undefined);
```

becomes:

```tsx
    await addExpense.mutateAsync(backdateTo || undefined);
```

Where `updateExpense`/`deleteExpense` are passed down to the row component as props, wrap them in thin closures matching the existing prop type:

```tsx
updateExpense={(id, patch) => updateExpense.mutateAsync({ id, patch }).then(() => undefined)}
deleteExpense={id => deleteExpense.mutateAsync(id).then(() => undefined)}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, add an expense (including a backdated one), edit description/amount/method, delete an expense — confirm all still work identically.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/hooks/useExpenses.ts apps/desktop/src/components/views/ExpensesView.tsx
git commit -m "refactor(desktop): migrate useExpenses to useMutation"
```

---

### Task 4: `useRates.ts` + `RateManagementView.tsx`

**Files:**
- Modify: `apps/desktop/src/lib/hooks/useRates.ts`
- Modify: `apps/desktop/src/components/views/RateManagementView.tsx`

**Interfaces:**
- Produces: `useRates()` returns `{ rates, setRate }` where `setRate` is now a `UseMutationResult` object.

- [ ] **Step 1: Replace `useRates.ts` in full**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type RateRow } from '../tauri/commands';

export interface RateWithCategory extends RateRow {
  categoryName: string;
  billingType: 'time' | 'frame';
}

export function useRates() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['rates'],
    queryFn: async (): Promise<RateWithCategory[]> => {
      const [categories, rateRows] = await Promise.all([commands.listCategories(), commands.listRates()]);
      const byCategoryId = new Map(rateRows.map(r => [r.categoryId, r]));
      return categories.map(c => {
        const existing = byCategoryId.get(c.id);
        const base: RateRow = existing ?? {
          id: '',
          categoryId: c.id,
          hour: c.billingType === 'time' ? 0 : null,
          half: c.billingType === 'time' ? 0 : null,
          value: c.billingType === 'frame' ? 0 : null,
          updatedAt: new Date().toISOString(),
        };
        return { ...base, categoryName: c.name, billingType: c.billingType };
      });
    },
  });

  const setRate = useMutation({
    mutationFn: (row: { categoryId: string; hour: number | null; half: number | null; value: number | null }) =>
      commands.upsertRate(row.categoryId, row.hour, row.half, row.value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates'] }),
  });

  return { rates: query.data ?? [], setRate };
}
```

- [ ] **Step 2: Migrate `RateManagementView.tsx`**

Both `onSubmit` functions (in `TimeRateCard` around line 42-49, and `FrameRateCard` around line 102-109) call `await setRate({...})`. Change both to:

```tsx
  async function onSubmit(data: TimeRateInput) {
    await setRate.mutateAsync({
      categoryId: row.categoryId,
      hour: data.hour,
      half: data.half,
      value: null,
    });
  }
```

and

```tsx
  async function onSubmit(data: FrameRateInput) {
    await setRate.mutateAsync({
      categoryId: row.categoryId,
      hour: null,
      half: null,
      value: data.value,
    });
  }
```

(same body, just `setRate.mutateAsync` instead of `setRate`.)

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, change a time-based category's hourly/half-hour rate and the frame-based category's rate (each autosaves `onBlur`) — confirm both still persist.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/hooks/useRates.ts apps/desktop/src/components/views/RateManagementView.tsx
git commit -m "refactor(desktop): migrate useRates to useMutation"
```

---

### Task 5: `useOrders.ts` + `CafeView.tsx`

**Files:**
- Modify: `apps/desktop/src/lib/hooks/useOrders.ts`
- Modify: `apps/desktop/src/components/views/CafeView.tsx`

**Interfaces:**
- Produces: `useOrders()` returns `{ checkout }` where `checkout` is now a `UseMutationResult` object. `useOrdersBetween`/`orderDateOf`/`orderTimeOf` are untouched (no mutations).

- [ ] **Step 1: Replace `useOrders.ts`'s `useOrders` function** (leave everything else in the file unchanged)

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type CartItemInput } from '../tauri/commands';
import { dateStrOf, localDateRangeToUtc } from '../shared/utils/dates';

// Orders have no `date` column -- updatedAt (a UTC instant) is the day they
// belong to. Read via local calendar date, not a UTC substring (see
// localDateRangeToUtc for why that drifts near local midnight).
export function orderDateOf(updatedAt: string): string {
  return dateStrOf(new Date(updatedAt));
}

export function orderTimeOf(updatedAt: string): string {
  return new Date(updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Only exposes checkout -- CafeView never reads back a list (the cart lives
// in useCart()); see useOrdersBetween below for historical reads.
export function useOrders() {
  const qc = useQueryClient();

  // Invalidating the ['orders']/['order-items'] prefixes also catches
  // useOrdersBetween's more specific keys. Checkout decrements stock
  // server-side too, so ['products'] is invalidated alongside them.
  const checkout = useMutation({
    mutationFn: (input: { items: CartItemInput[]; method: string; customerId: string | null }) =>
      commands.createOrder(input.items, input.method, input.customerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order-items'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return { checkout };
}
```

- [ ] **Step 2: Migrate `CafeView.tsx`**

The current `completeSale` uses one local `error` state for two different things: a pre-checkout client validation message ("A customer must be selected for Credit sales") and a checkout-failure message. Split these — rename the validation state and read the mutation's own error for the second case. Replace (lines 22-23):

```tsx
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
```

with:

```tsx
  const [validationError, setValidationError] = useState<string | null>(null);
```

Replace `completeSale` (lines 38-60):

```tsx
  async function completeSale() {
    if (lines.length === 0) return;
    if (method === 'Credit' && !customerId) {
      setError('A customer must be selected for Credit sales');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await checkout(
        lines.map(l => ({ productId: l.product.id, qty: l.qty })),
        method,
        method === 'Credit' ? customerId : null,
      );
      clearCart();
      setMethod('Cash');
      setCustomerId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  }
```

with:

```tsx
  async function completeSale() {
    if (lines.length === 0) return;
    if (method === 'Credit' && !customerId) {
      setValidationError('A customer must be selected for Credit sales');
      return;
    }
    setValidationError(null);
    try {
      await checkout.mutateAsync({
        items: lines.map(l => ({ productId: l.product.id, qty: l.qty })),
        method,
        customerId: method === 'Credit' ? customerId : null,
      });
      clearCart();
      setMethod('Cash');
      setCustomerId(null);
    } catch {
      // checkout.error is already populated; nothing further to do here
    }
  }
```

Replace the error/button JSX (lines 158-162):

```tsx
          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="button" disabled={submitting || lines.length === 0} onClick={completeSale}>
            Complete sale
          </Button>
```

with:

```tsx
          {(validationError || checkout.error) && (
            <p className="text-sm text-destructive">{validationError ?? checkout.error?.message}</p>
          )}

          <Button type="button" disabled={checkout.isPending || lines.length === 0} onClick={completeSale}>
            Complete sale
          </Button>
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, complete a Cash sale, attempt a Credit sale with no customer selected (confirm the validation message still shows), complete a Credit sale with a customer selected — confirm stock/cart/order list all update as before.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/hooks/useOrders.ts apps/desktop/src/components/views/CafeView.tsx
git commit -m "refactor(desktop): migrate useOrders to useMutation"
```

---

### Task 6: `useProducts.ts` + `ProductManagementView.tsx`

**Files:**
- Modify: `apps/desktop/src/lib/hooks/useProducts.ts`
- Modify: `apps/desktop/src/components/views/ProductManagementView.tsx`

**Interfaces:**
- Produces: `useProducts()` returns `{ categories, products, isLoading, addCategory, addProduct, updateProduct, adjustStock }` where the four mutation fields are now `UseMutationResult` objects. `productsByCategory` (a plain filter function) is untouched.

- [ ] **Step 1: Replace `useProducts.ts`'s `useProducts` function** (leave `productsByCategory`, lines 53-55, unchanged)

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commands, type ProductRow } from '../tauri/commands';

export function useProducts() {
  const qc = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ['product-categories'], queryFn: () => commands.listProductCategories() });
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: () => commands.listProducts() });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['product-categories'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  }

  const addCategory = useMutation({
    mutationFn: (name: string) => commands.createProductCategory(name),
    onSuccess: invalidate,
  });

  const addProduct = useMutation({
    mutationFn: (input: {
      categoryId: string;
      name: string;
      price: number;
      cost: number | null;
      lowStockThreshold: number;
      barcode: string | null;
    }) =>
      commands.createProduct(
        input.categoryId, input.name, input.price, input.cost, input.lowStockThreshold, input.barcode,
      ),
    onSuccess: invalidate,
  });

  const updateProduct = useMutation({
    mutationFn: (input: {
      id: string;
      name: string;
      price: number;
      cost: number | null;
      lowStockThreshold: number;
      barcode: string | null;
      active: boolean;
    }) =>
      commands.updateProduct(
        input.id, input.name, input.price, input.cost, input.lowStockThreshold, input.barcode, input.active,
      ),
    onSuccess: invalidate,
  });

  const adjustStock = useMutation({
    mutationFn: (input: { productId: string; delta: number; reason: string; note: string | null }) =>
      commands.adjustStock(input.productId, input.delta, input.reason, input.note),
    onSuccess: invalidate,
  });

  return {
    categories: categoriesQuery.data ?? [],
    products: productsQuery.data ?? [],
    isLoading: categoriesQuery.isLoading || productsQuery.isLoading,
    addCategory, addProduct, updateProduct, adjustStock,
  };
}

export function productsByCategory(products: ProductRow[], categoryId: string): ProductRow[] {
  return products.filter(p => p.categoryId === categoryId && p.active);
}
```

Note: `adjustStock`'s `mutationFn` now takes one object (`{productId, delta, reason, note}`) instead of 4 positional args — this changes `ProductRowEditor`'s `onAdjustStock` prop shape too (see Step 3).

- [ ] **Step 2: Migrate `ProductManagementView.tsx`'s top-level wiring**

Replace (lines 21-22):

```tsx
      <NewCategoryCard onCreated={addCategory} />
      <NewProductCard categories={categories} onCreated={addProduct} />
```

with:

```tsx
      <NewCategoryCard onCreated={async name => { await addCategory.mutateAsync(name); }} />
      <NewProductCard categories={categories} onCreated={async input => { await addProduct.mutateAsync(input); }} />
```

Replace (lines 43-44):

```tsx
                    onSave={updateProduct}
                    onAdjustStock={adjustStock}
```

with:

```tsx
                    onSave={async input => { await updateProduct.mutateAsync(input); }}
                    onAdjustStock={async (productId, delta, reason, note) => {
                      await adjustStock.mutateAsync({ productId, delta, reason, note });
                    }}
```

`NewCategoryCard`, `NewProductCard`, and `ProductRowEditor`'s own prop type signatures (lines 56, 91-97, 182-190) and internal `submitting`/`error` state are unchanged — they still receive plain `(...) => Promise<void>` functions, just now backed by mutations instead of the old `useInvalidateAfter`-wrapped calls.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev`, add a product category, add a product, edit a product's name/price/cost, adjust its stock, toggle active/inactive — confirm all still work identically.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/hooks/useProducts.ts apps/desktop/src/components/views/ProductManagementView.tsx
git commit -m "refactor(desktop): migrate useProducts to useMutation"
```

---

### Task 7: Delete `useInvalidateAfter.ts`

**Files:**
- Delete: `apps/desktop/src/lib/hooks/useInvalidateAfter.ts`

**Interfaces:**
- Consumes: nothing (this task runs after Tasks 1-6, which are its only callers).

- [ ] **Step 1: Confirm nothing imports it anymore**

Run: `grep -rn "useInvalidateAfter" apps/desktop/src --include="*.ts" --include="*.tsx"`
Expected: only the file's own definition, no import sites (Tasks 1-6 removed all 6). If any import remains, stop — a hook-level task was missed or reverted; do not proceed with deletion until every import is gone.

- [ ] **Step 2: Delete the file**

```bash
git rm apps/desktop/src/lib/hooks/useInvalidateAfter.ts
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(desktop): delete useInvalidateAfter, superseded by useMutation"
```

---

### Task 8: Desktop's 4 ad-hoc view-level admin screens

**Files:**
- Modify: `apps/desktop/src/components/views/RoleManagementView.tsx`
- Modify: `apps/desktop/src/components/views/CategoryManagementView.tsx`
- Modify: `apps/desktop/src/components/views/BackupSettingsView.tsx`
- Modify: `apps/desktop/src/components/views/UserManagementView.tsx`

**Interfaces:**
- None of these have a shared data hook backing them today (a deliberate pre-existing choice, kept here) — each gets its own inline `useMutation()` call(s).

- [ ] **Step 1: Migrate `RoleManagementView.tsx`**

In `NewRoleCard` (around line 80-125), replace the `submit` function's body:

```tsx
function NewRoleCard({ onCreated }: { onCreated: () => void }) {
  const { state } = useAuth();
  const accessToken = state.accessToken;
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const permissionsQuery = useQuery({
    queryKey: ['admin-permissions'],
    queryFn: () => apiFetch<{ id: string; key: string }[]>('/roles/permissions', { accessToken }),
  });

  const createRole = useMutation({
    mutationFn: (input: { name: string; permissionIds: string[] }) =>
      apiFetch('/roles', { method: 'POST', accessToken, body: JSON.stringify(input) }),
  });

  function toggle(key: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function submit() {
    if (!name.trim()) return;
    const permissionIds = (permissionsQuery.data ?? [])
      .filter(p => selected.has(p.key))
      .map(p => p.id);
    await createRole.mutateAsync({ name: name.trim(), permissionIds });
    setName('');
    setSelected(new Set());
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add role</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="new-role-name">Role name</FieldLabel>
          <Input id="new-role-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Shift Supervisor" />
        </Field>
        <PermissionCheckboxes selected={selected} onChange={toggle} />
        {createRole.error && <p className="text-sm text-destructive">{createRole.error.message}</p>}
        <Button type="button" className="self-start" disabled={createRole.isPending || !name.trim()} onClick={submit}>
          Create role
        </Button>
      </CardContent>
    </Card>
  );
}
```

In `RoleCard` (around line 147-228), replace `save`/`remove`:

```tsx
function RoleCard({ role, onChanged }: { role: RoleRow; onChanged: () => void }) {
  const { state } = useAuth();
  const accessToken = state.accessToken;
  const [name, setName] = useState(role.name);
  const [selected, setSelected] = useState<Set<string>>(new Set(role.permissions.map(p => p.key)));

  const permissionsQuery = useQuery({
    queryKey: ['admin-permissions'],
    queryFn: () => apiFetch<{ id: string; key: string }[]>('/roles/permissions', { accessToken }),
  });

  const updateRole = useMutation({
    mutationFn: (input: { name: string; permissionIds: string[] }) =>
      apiFetch(`/roles/${role.id}`, { method: 'PATCH', accessToken, body: JSON.stringify(input) }),
  });

  const deleteRole = useMutation({
    mutationFn: () => apiFetch(`/roles/${role.id}`, { method: 'DELETE', accessToken }),
  });

  function toggle(key: string, checked: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function save() {
    const permissionIds = (permissionsQuery.data ?? [])
      .filter(p => selected.has(p.key))
      .map(p => p.id);
    await updateRole.mutateAsync({ name: name.trim(), permissionIds });
    onChanged();
  }

  async function remove() {
    await deleteRole.mutateAsync();
    onChanged();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>
          {role.name}
          {role.isSystem && <span className="ml-2 text-sm font-normal text-muted-foreground">(system role)</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor={`role-name-${role.id}`}>Role name</FieldLabel>
          <Input
            id={`role-name-${role.id}`}
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={role.isSystem}
          />
        </Field>
        <PermissionCheckboxes selected={selected} onChange={toggle} disabled={role.isSystem} />
        {(updateRole.error || deleteRole.error) && (
          <p className="text-sm text-destructive">{(updateRole.error ?? deleteRole.error)?.message}</p>
        )}
        {!role.isSystem && (
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={save} disabled={updateRole.isPending}>
              Save
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={deleteRole.isPending}>
              Delete role
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

Add `useMutation` to the `@tanstack/react-query` import at the top of the file (currently `import { useQuery, useQueryClient } from '@tanstack/react-query';`).

`RoleManagementView`'s top-level `refresh()` (lines 35-38) and its `useQueryClient()` call stay as-is — that part isn't a mutation, it's the invalidation callback passed to the two child cards as `onCreated`/`onChanged`, and both still call it after their own mutation succeeds.

- [ ] **Step 2: Migrate `CategoryManagementView.tsx`**

In `NewCategoryCard` (lines 55-107):

```tsx
function NewCategoryCard({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [billingType, setBillingType] = useState<'time' | 'frame'>('time');

  const createCategory = useMutation({
    mutationFn: (input: { name: string; billingType: string }) =>
      commands.createCategory(input.name, input.billingType),
  });

  async function submit() {
    if (!name.trim()) return;
    await createCategory.mutateAsync({ name: name.trim(), billingType });
    setName('');
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add category</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup className="@md/field-group:flex-row @md/field-group:items-end">
          <Field>
            <FieldLabel htmlFor="new-category-name">Name</FieldLabel>
            <Input id="new-category-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Foosball" />
          </Field>
          <Field className="@md/field-group:max-w-40">
            <FieldLabel htmlFor="new-category-billing">Billing</FieldLabel>
            <Select value={billingType} onValueChange={v => setBillingType(v as 'time' | 'frame')}>
              <SelectTrigger id="new-category-billing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="time">By time</SelectItem>
                <SelectItem value="frame">By frame</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button type="button" disabled={createCategory.isPending || !name.trim()} onClick={submit}>
            Add category
          </Button>
        </FieldGroup>
        {createCategory.error && <p className="mt-2 text-sm text-destructive">{createCategory.error.message}</p>}
      </CardContent>
    </Card>
  );
}
```

In `RenameCategoryForm` (lines 109-142), replace `commit`:

```tsx
  const updateCategory = useMutation({
    mutationFn: (input: { name: string; billingType: string }) =>
      commands.updateCategory(categoryId, input.name, input.billingType),
  });

  async function commit() {
    if (!name.trim() || name === currentName) return;
    // billingType isn't editable in this UI, but update_category always
    // writes the full row -- pass the category's current value through so a
    // rename never silently blanks it out.
    await updateCategory.mutateAsync({ name: name.trim(), billingType });
    onRenamed();
  }
```

(add this `useMutation` call inside the component, before `commit`; the `Button`'s `disabled` can optionally also add `|| updateCategory.isPending`, matching the pattern above).

In `RenameStationForm` (lines 144-169), same shape:

```tsx
  const updateStation = useMutation({
    mutationFn: (name: string) => commands.updateStation(stationId, name),
  });

  async function commit() {
    if (!name.trim() || name === currentName) return;
    await updateStation.mutateAsync(name.trim());
    onRenamed();
  }
```

In `NewStationForm` (lines 171-201):

```tsx
  const createStation = useMutation({
    mutationFn: (name: string) => commands.createStation(categoryId, name),
  });

  async function submit() {
    if (!name.trim()) return;
    await createStation.mutateAsync(name.trim());
    setName('');
    onCreated();
  }
```

(replacing the local `submitting` state — `createStation.isPending` drives the button's `disabled` instead).

Add `useMutation` to this file's `@tanstack/react-query` import (currently `import { useQueryClient } from '@tanstack/react-query';`).

- [ ] **Step 3: Migrate `BackupSettingsView.tsx`**

```tsx
export default function BackupSettingsView() {
  const qc = useQueryClient();
  const [restoredFilename, setRestoredFilename] = useState<string | null>(null);

  const backupsQuery = useQuery({ queryKey: ['backups'], queryFn: () => commands.listBackups() });
  const dirQuery = useQuery({ queryKey: ['backup-dir'], queryFn: () => commands.getBackupDir() });

  const backup = useMutation({
    mutationFn: () => commands.backupNow(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });

  const restore = useMutation({
    mutationFn: (filename: string) => commands.restoreBackup(filename),
    onSuccess: (_data, filename) => setRestoredFilename(filename),
  });

  if (restoredFilename) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Restore complete</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Restored from <span className="font-medium text-foreground">{restoredFilename}</span>. Close and
              reopen {branding.appName} for the restored data to take effect.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {dirQuery.data && (
            <p className="text-sm text-muted-foreground">Backups are stored at {dirQuery.data}</p>
          )}
          <Button type="button" disabled={backup.isPending} onClick={() => backup.mutate()} className="self-start">
            Back up now
          </Button>
          {backup.isSuccess && <p className="text-sm text-muted-foreground">Backup created: {backup.data.filename}</p>}
          {backup.error && <p className="text-sm text-destructive">Backup failed: {backup.error.message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Restore</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {backupsQuery.isLoading ? (
            <ListSkeleton />
          ) : !backupsQuery.data || backupsQuery.data.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No backups yet.</p>
          ) : (
            <div className="flex flex-col gap-2 px-4">
              {backupsQuery.data.map((backupInfo: BackupInfo) => (
                <div key={backupInfo.filename} className="flex items-center justify-between rounded-lg border border-border p-2">
                  <div>
                    <p className="text-sm font-medium">{backupInfo.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(backupInfo.createdAt).toLocaleString()} · {formatBytes(backupInfo.sizeBytes)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={backup.isPending || restore.isPending}
                    onClick={() => restore.mutate(backupInfo.filename)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}
          {restore.error && <p className="mt-2 px-4 text-sm text-destructive">Restore failed: {restore.error.message}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
```

Note the behavior refinement here: the original `message` string showed either a success or failure message for whichever action (`backup`/`restore`) ran most recently, in one shared spot. Since each is now its own mutation with its own `isSuccess`/`data`/`error`, the success/failure text is shown next to the button that triggered it instead of in one shared location — this is a minor, deliberate layout improvement that falls directly out of using two independent mutations rather than one shared `message` string; it does not change what information is shown, only where.

Add `useMutation` to the `@tanstack/react-query` import (currently `import { useQuery, useQueryClient } from '@tanstack/react-query';`).

- [ ] **Step 4: Migrate `UserManagementView.tsx`**

Replace the `useForm`/`onSubmit` block (around lines 71-96):

```tsx
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: { username: '', pin: '', name: '', roleId: '' },
  });

  async function onSubmit(data: CreateUserInput) {
    setFormError(null);
    try {
      await apiFetch<UserRow>('/users', {
        method: 'POST',
        body: JSON.stringify(data),
        accessToken,
      });
      reset();
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create user');
    }
  }
```

with:

```tsx
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: { username: '', pin: '', name: '', roleId: '' },
  });

  const createUser = useMutation({
    mutationFn: (data: CreateUserInput) =>
      apiFetch<UserRow>('/users', { method: 'POST', body: JSON.stringify(data), accessToken }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  async function onSubmit(data: CreateUserInput) {
    await createUser.mutateAsync(data);
    reset();
  }
```

Remove the `formError`/`setFormError` `useState` declaration entirely (it's fully superseded by `createUser.error`). Replace its render site:

```tsx
            {formError && (
              <p role="alert" className="text-sm font-normal text-destructive">
                {formError}
              </p>
            )}
```

with:

```tsx
            {createUser.error && (
              <p role="alert" className="text-sm font-normal text-destructive">
                {createUser.error.message}
              </p>
            )}
```

Update the submit button's `disabled` to also cover the mutation: `disabled={isSubmitting || createUser.isPending}`.

Add `useMutation` to the `@tanstack/react-query` import (currently `import { useQuery, useQueryClient } from '@tanstack/react-query';`).

- [ ] **Step 5: Verify**

Run: `pnpm --filter @cue-room/desktop exec tsc -b`
Expected: no errors.

Run (from `apps/desktop`): `pnpm dev` as an Owner/Admin user:
- Role Management: create a role, edit a role's name/permissions, delete a non-system role.
- Category Management: add a category, rename a category, add a station, rename a station.
- Backup: run a backup, restore a backup (in a disposable test environment only).
- User Management: create a user, and confirm a duplicate-username error still displays inline.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/views/RoleManagementView.tsx apps/desktop/src/components/views/CategoryManagementView.tsx apps/desktop/src/components/views/BackupSettingsView.tsx apps/desktop/src/components/views/UserManagementView.tsx
git commit -m "refactor(desktop): migrate 4 ad-hoc admin views to useMutation"
```

---

### Task 9: Web's `UserManagementView.tsx`

**Files:**
- Modify: `apps/web/src/components/views/UserManagementView.tsx`

**Interfaces:**
- None (mirrors Task 8's desktop `UserManagementView` migration exactly — same field names, same `CreateUserSchema`/`CreateUserInput`, same `/users` endpoint).

- [ ] **Step 1: Migrate `apps/web/src/components/views/UserManagementView.tsx`**

Apply the identical transformation as Task 8 Step 4 (desktop's `UserManagementView.tsx`): add `useMutation` to the `@tanstack/react-query` import, replace the manual `try/catch`+`apiFetch`+`formError` pattern in `onSubmit` with a `createUser = useMutation({...})` call, remove the `formError` state, read `createUser.error`/`createUser.isPending` in its place. Desktop and web's current `UserManagementView.tsx` files are near-byte-identical, so the before/after code is the same shape.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @cue-room/web exec tsc -b`
Expected: no errors.

Run (from `apps/web`): `pnpm dev`, log in as Owner/Admin, create a user, confirm a duplicate-username error still displays inline.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/views/UserManagementView.tsx
git commit -m "refactor(web): migrate UserManagementView to useMutation"
```

---

## Final verification (after all 9 tasks)

- [ ] Run `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web exec tsc -b`
  Expected: both clean.
- [ ] Run `grep -rn "useInvalidateAfter" apps/desktop/src` — expect zero matches (file deleted in Task 7, no stale imports).
- [ ] Run the full desktop e2e suite (`pnpm --filter @cue-room/desktop test:e2e`) — every spec touching a mutation (checkout, sessions, expenses, customers, credit, rates, products, categories/stations, roles, users, backup) is a behavioral check on this sub-project.
- [ ] Run the full web e2e suite (`pnpm --filter @cue-room/web test:e2e`) — in particular any spec touching web's User Management.
- [ ] Manual check on both apps (`pnpm dev`): trigger at least one failure path per migrated mutation (e.g. a duplicate username, a Credit checkout with no customer, insufficient stock) and confirm the error still surfaces to the user.
