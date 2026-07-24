import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { db } from '../lib/db/dexie';
import { useCustomers } from '../lib/hooks/useCustomers';
import type { Session, Customer } from '@/lib/shared';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCustomers', () => {
  beforeEach(async () => {
    await db.customers.clear();
    await db.sessions.clear();
    await db.creditEntries.clear();
    await db.outbox.clear();
  });

  it('excludes soft-deleted Credit sessions from the customer balance', async () => {
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

    const { result } = renderHook(() => useCustomers(), { wrapper });

    await waitFor(() => expect(result.current.customers).toHaveLength(1));
    // Only the active Credit session's amount (200) should count; the
    // soft-deleted one (500) must not inflate the outstanding balance.
    await waitFor(() => expect(result.current.balanceFor('cust-1')).toBe(200));
  });
});
