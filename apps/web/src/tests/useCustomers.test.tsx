import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { db } from '../lib/db/dexie';
import { useCustomers } from '../lib/hooks/useCustomers';
import CreditManagementView from '../components/views/CreditManagementView';
import type { Session, Customer } from '@/lib/shared';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function seedCustomerWithMixedSessions() {
  const customer: Customer = { id: 'cust-1', name: 'Ravi', phone: '', updatedAt: new Date().toISOString(), deletedAt: null };
  await db.customers.put(customer);

  const activeSession: Session = {
    id: 'sess-1', category: '8-Ball', resource: 'Table 1', date: '2026-07-23',
    start: '09:00', end: '10:00', amount: 200, method: 'Credit', customerId: 'cust-1',
    updatedAt: new Date().toISOString(), deletedAt: null,
  };
  const deletedSession: Session = {
    id: 'sess-2', category: '8-Ball', resource: 'Table 2', date: '2026-07-23',
    start: '09:00', end: '10:00', amount: 500, method: 'Credit', customerId: 'cust-1',
    updatedAt: new Date().toISOString(), deletedAt: new Date().toISOString(),
  };
  await db.sessions.put(activeSession);
  await db.sessions.put(deletedSession);
}

describe('useCustomers', () => {
  beforeEach(async () => {
    await db.customers.clear();
    await db.sessions.clear();
    await db.creditEntries.clear();
    await db.outbox.clear();
  });

  it('excludes soft-deleted Credit sessions from the customer balance', async () => {
    await seedCustomerWithMixedSessions();

    const { result } = renderHook(() => useCustomers(), { wrapper });

    await waitFor(() => expect(result.current.customers).toHaveLength(1));
    // Only the active Credit session's amount (200) should count; the
    // soft-deleted one (500) must not inflate the outstanding balance.
    await waitFor(() => expect(result.current.balanceFor('cust-1')).toBe(200));
  });

  it(
    'stays correct on the real Credit Management screen across a query invalidation ' +
      '(regression: CreditManagementView used to register its own second, unfiltered ' +
      "useQuery under the SAME ['all-sessions'] key useCustomers() uses. Both observers " +
      'share one TanStack Query cache entry -- the *first* render fetches once and looks ' +
      'fine, but the second observer\'s setOptions() call overwrites the shared query\'s ' +
      'stored queryFn to the unfiltered one, so the *next* refetch -- e.g. the sync engine\'s ' +
      "invalidateQueries() every 30s, or any local mutation's invalidateQueries() -- silently " +
      're-fetches with the unfiltered queryFn and inflates the balance. Verified directly: ' +
      'reproducing the exact old two-observer shape and calling invalidateQueries() flips a ' +
      'correct ₹200 balance to an incorrect ₹700 one)',
    async () => {
      await seedCustomerWithMixedSessions();

      // A single shared QueryClient, exactly like the real app's one
      // QueryClientProvider at the root -- the previous test's blind spot was
      // giving each hook its own isolated QueryClient, so nothing else could
      // ever observe or corrupt its cache entry.
      const client = new QueryClient();

      render(
        <QueryClientProvider client={client}>
          <CreditManagementView />
        </QueryClientProvider>,
      );

      await waitFor(() => expect(screen.getByTestId('balance-Ravi').textContent).toContain('200'));

      // Simulate what happens constantly in the real app: the sync engine's
      // 30s cycle (and every local mutation hook) calls
      // queryClient.invalidateQueries(), forcing every active query -- including
      // ['all-sessions'] -- to refetch. Under the old buggy shape this is
      // exactly the trigger that flips the balance to the unfiltered value.
      await client.invalidateQueries();

      // The real screen must still show the filtered balance (200) after a
      // refetch, not the unfiltered one (700). (No @testing-library/jest-dom
      // in this project, so assert on .textContent directly rather than
      // toHaveTextContent.)
      await waitFor(() => expect(screen.getByTestId('balance-Ravi').textContent).toContain('200'));
      expect(screen.getByTestId('balance-Ravi').textContent).not.toContain('700');
    },
  );
});
