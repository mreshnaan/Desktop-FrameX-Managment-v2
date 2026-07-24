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
  beforeEach(async () => {
    await db.sessions.clear();
    await db.outbox.clear();
    await db.rates.clear();
    await db.categories.clear();
    await db.stations.clear();
  });

  it('adds a time-based session and auto-calculates the amount on time entry', async () => {
    await db.categories.put({ id: 'cat-8ball', name: '8-Ball', billingType: 'time' });
    await db.stations.put({ id: 'station-1', categoryId: 'cat-8ball', name: 'Table 1' });
    await db.rates.put({ id: 'rate-1', categoryId: 'cat-8ball', hour: 200, half: 100, value: null, updatedAt: new Date().toISOString() });
    const { result } = renderHook(() => useSessions('2026-07-23'), { wrapper });

    await act(async () => { await result.current.addSession('station-1', 'cat-8ball', 'time'); });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    const id = result.current.sessions[0].id;

    await act(async () => { await result.current.updateSession(id, { start: '09:00', end: '10:30' }); });
    await waitFor(() => expect(result.current.sessions[0].amount).toBe(300));
  });

  it('seeds a frame-based session\'s amount from the category rate immediately, with no start/end', async () => {
    await db.categories.put({ id: 'cat-snooker', name: 'Snooker', billingType: 'frame' });
    await db.stations.put({ id: 'station-2', categoryId: 'cat-snooker', name: 'Table 1' });
    await db.rates.put({ id: 'rate-2', categoryId: 'cat-snooker', hour: null, half: null, value: 150, updatedAt: new Date().toISOString() });
    const { result } = renderHook(() => useSessions('2026-07-23'), { wrapper });

    await act(async () => { await result.current.addSession('station-2', 'cat-snooker', 'frame'); });
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.sessions[0].amount).toBe(150);
  });
});
