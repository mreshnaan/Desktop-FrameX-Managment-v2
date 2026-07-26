# useMutation migration — design

> Sub-project 5 of the codebase-cleanup refactor (branch `refactor/codebase-cleanup`).
> Sub-projects 1-4 (web bounded reads, hooks+types cleanup, Rust backend SOLID cleanup,
> shared table/form components) are complete. This is a new area, raised mid-session
> rather than part of the original 5-area audit. A separate area (Session/Order
> paid-vs-pending status) is scoped independently and not started.

## Goal

Every mutation in both apps today is hand-rolled: hook-level writes call a plain async
function that awaits a command/API call, then manually invalidates query keys (via
sub-project 2's `useInvalidateAfter` helper); view-level writes (10 sites with no
dedicated data hook) do the same thing inline, each reinventing its own
submitting/error state. `@tanstack/react-query`'s `useMutation` — confirmed completely
unused today (zero matches repo-wide) — already provides everything both patterns
hand-roll: pending state, error state, and an `onSuccess` hook for invalidation. This
sub-project replaces both patterns with `useMutation` everywhere, and deletes
`useInvalidateAfter` as dead code once nothing calls it.

## 1. Hook-level mutations (15 sites, 6 files)

**Sites:** `useCustomers.ts` (`addCustomer`, `deleteCustomer`, `adjustCustomer`),
`useSessions.ts` (`addSession`, `updateSession`, `deleteSession`), `useExpenses.ts`
(`addExpense`, `updateExpense`, `deleteExpense`), `useRates.ts` (`setRate`),
`useOrders.ts` (`checkout`), `useProducts.ts` (`addCategory`, `addProduct`,
`updateProduct`, `adjustStock`).

Each mutation function currently looks like this (`useCustomers.ts`, confirmed
current code):

```ts
const invalidateCustomers = useInvalidateAfter([['customers'], ['customer-balances']]);

async function addCustomer(input: { name: string; phone?: string }) {
  await invalidateCustomers(() => commands.createCustomer(input.name, input.phone ?? ''));
}
```

Becomes:

```ts
const addCustomer = useMutation({
  mutationFn: (input: { name: string; phone?: string }) =>
    commands.createCustomer(input.name, input.phone ?? ''),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['customers'] });
    qc.invalidateQueries({ queryKey: ['customer-balances'] });
  },
});
```

and the hook returns `addCustomer` itself (the full `UseMutationResult`), not a
wrapper function — every call site's shape changes from `await addCustomer(input)` to
either `addCustomer.mutate(input)` (fire-and-forget) or `await
addCustomer.mutateAsync(input)` (when the caller needs to chain on completion, e.g.
resetting a form only after success). Each hook keeps its existing `useQueryClient()`
call (`qc`) for the `onSuccess` invalidation; every invalidated query key from the
current `useInvalidateAfter` call sites carries over exactly (verified per hook during
implementation, not assumed) — no key gets dropped, merged, or renamed.

Multi-mutation hooks (e.g. `useCustomers` has 3) get one independent `useMutation()`
call per mutation — TanStack Query's `isPending`/`isError` are per-mutation-instance,
not global, so this is required, not a stylistic choice.

**Unavoidable consequence, not a stylistic choice:** `mutate`/`mutateAsync` accept
exactly one `variables` argument, matching `mutationFn: (variables: TVariables) =>
Promise<TData>`. Several current functions take multiple positional arguments —
`useOrders.checkout(items, method, customerId)`, `useCustomers.adjustCustomer(customerId,
date, type, amount)`, `useSessions.updateSession(id, patch)`,
`useExpenses.updateExpense(id, description?, amount?, method?)` — each of these
becomes a single `{ ... }` object parameter on both `mutationFn` and every call site
that invokes it. Functions that already take one object param (`useProducts.addProduct`,
`.updateProduct`) are unaffected. This is called out here so no implementer discovers
it mid-task and has to guess whether to change the argument shape — every multi-arg
mutation function's argument shape changes to a single object, everywhere it's called.

`useInvalidateAfter.ts` (`apps/desktop/src/lib/hooks/useInvalidateAfter.ts`) is
deleted once these 6 files no longer import it — confirmed no other file uses it
today (its only consumers are exactly these 6 hooks).

## 2. View-level ad-hoc mutations (10 sites, no dedicated data hook)

**Sites:** `RoleManagementView.tsx` (3 mutations: create/rename/etc.),
`CategoryManagementView.tsx` (4 mutations — deliberately left outside the
hook-based pattern in sub-project 2, since it uses view-level `commands.X()` calls +
`onCreated`/`onRenamed` callback props rather than a shared hook; that architecture is
kept here, only the mutation mechanism changes), `BackupSettingsView.tsx` (1 —
backup only; restore doesn't invalidate anything today and stays that way),
`apps/desktop/src/components/views/UserManagementView.tsx` and
`apps/web/src/components/views/UserManagementView.tsx` (1 each — direct `apiFetch`
POST).

None of these have a shared data-hook file backing them (confirmed during scoping —
this is a deliberate pre-existing architectural choice, not an oversight this
sub-project needs to fix). Rather than also creating new hook files for them (a
separate restructuring decision beyond "adopt `useMutation`"), each gets its own
`useMutation()` call defined directly inside the component:

```tsx
// UserManagementView.tsx (both apps), replacing the current manual
// try/catch + apiFetch + queryClient.invalidateQueries call:
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

`createUser.error` (an `Error | null`) replaces the current manual `formError` state;
`createUser.isPending` replaces RHF's `isSubmitting` for the submit button's disabled
state (RHF's own `isSubmitting` still exists and still gates client-side validation,
but the button's pending/disabled visual now reflects the actual network request, not
just synchronous validation).

## 3. Consuming components: unify 3 patterns into 1

Confirmed during scoping: desktop views split three ways today —
- RHF `formState.isSubmitting` only, no explicit error display beyond field
  validation (`CustomersView.tsx`, `RateManagementView.tsx`,
  `CreditManagementView.tsx`).
- Plain `useState` + manual `try/catch/finally` (`ProductManagementView.tsx`,
  `CategoryManagementView.tsx`, `BackupSettingsView.tsx`).
- No submitting flag at all, blur-to-save inline editing with a local `error` string
  (`ExpensesView.tsx`, `DailySalesView.tsx`).

After this sub-project, every mutation-triggering component reads
`.isPending`/`.isError`/`.error` from its mutation object instead of managing its own
local state for that purpose. Exception: `ProductManagementView.tsx`'s child
components `NewCategoryCard`/`NewProductCard` keep their pre-existing local
`submitting`/`error` `useState` and were deliberately not touched — the plan itself
required not modifying children that consume mutations via wrapper closures (Tasks 2,
3, 6), and these two are exactly that case. `ExpensesView.tsx`/`DailySalesView.tsx`'s
blur-to-save `commit()` helpers keep their local `error` state **only** for
client-side zod validation failures caught before the mutation is even called (that's
a different concern — invalid input never reaching the network — and is out of
scope); the mutation's own `.error` covers what happens after the call is made.

**`CafeView.tsx`'s checkout is the clearest before/after** (confirmed current code:
local `submitting`/`error` `useState`, manual `try/catch/finally` around
`useOrders().checkout()`):

```tsx
// Before
const [submitting, setSubmitting] = useState(false);
const [error, setError] = useState<string | null>(null);
async function completeSale() {
  setSubmitting(true);
  setError(null);
  try {
    await checkout(cart.items, method, customerId);
    cart.clear();
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Checkout failed');
  } finally {
    setSubmitting(false);
  }
}

// After
const checkout = useOrders().checkout; // now a UseMutationResult
async function completeSale() {
  try {
    await checkout.mutateAsync({ items: cart.items, method, customerId });
    cart.clear();
  } catch {
    // checkout.error is already populated; nothing further to do here
  }
}
```

The `try/catch` around `mutateAsync` stays (needed so a rejected mutation doesn't
also throw out of `completeSale` and skip `cart.clear()`'s "only clear on success"
guarantee), but the `error`/`submitting` state and the `finally` block are gone —
`checkout.isPending`/`checkout.error` drive the button directly.

## Testing

No behavior change is intended: same mutation calls, same invalidated query keys,
same success/failure UI outcomes — only the state-management mechanism changes.
Verification is:

- `pnpm --filter @cue-room/desktop exec tsc -b` and `pnpm --filter @cue-room/web exec
  tsc -b` (catches any call site still using the old function-call shape after a hook
  changes its return type).
- Full desktop e2e suite and full web e2e suite — every spec that exercises a mutation
  (checkout, session/expense CRUD, customer/credit management, rate management,
  category/product/role/user management, backup) is a behavioral check on this
  sub-project, since there is no unit-test layer for these view/hook interactions
  today (per this project's existing convention).
- Manual check (`pnpm dev` on both apps): trigger at least one failure path per
  migrated mutation (e.g. a network/validation error) and confirm the error still
  surfaces to the user, since this is the one behavior most at risk of silently
  changing shape (a caught-and-displayed error becoming an uncaught rejection, or
  vice versa).
