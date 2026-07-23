import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { db } from '../lib/db/dexie';
import { useSessions } from '../lib/hooks/useSessions';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useSessions', () => {
  beforeEach(async () => { await db.sessions.clear(); await db.outbox.clear(); await db.rates.clear(); });

  it('adds a time-based session and auto-calculates the amount on time entry', async () => {
    await db.rates.put({ category: '8-Ball', hour: 200, half: 100, value: null, updatedAt: new Date().toISOString() });
    const { result } = renderHook(() => useSessions('2026-07-23'), { wrapper });

    await act(async () => { await result.current.addSession('8-Ball', 'Table 1'); });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    const id = result.current.sessions[0].id;

    await act(async () => { await result.current.updateSession(id, { start: '09:00', end: '10:30' }); });
    await waitFor(() => expect(result.current.sessions[0].amount).toBe(300));
  });
});
