import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { startSyncEngine } from '../lib/sync/syncEngine';

const CURSOR_KEY = 'cue-room-desktop-sync-cursor';

const drainOutbox = vi.fn();
const deleteOutboxEntries = vi.fn();
const applyPulledRows = vi.fn();

vi.mock('../lib/tauri/commands', () => ({
  commands: {
    drainOutbox: (...args: unknown[]) => drainOutbox(...args),
    deleteOutboxEntries: (...args: unknown[]) => deleteOutboxEntries(...args),
    applyPulledRows: (...args: unknown[]) => applyPulledRows(...args),
  },
}));

const emptyPull = {
  sessions: [], expenses: [], customers: [], creditEntries: [], rates: [], offers: [], categories: [], stations: [],
  productCategories: [], products: [], orders: [], orderItems: [], stockMovements: [],
  serverTime: '2026-07-24T00:00:00.000Z',
};

describe('desktop syncEngine', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.removeItem(CURSOR_KEY);
    vi.stubGlobal('navigator', { onLine: true });
    drainOutbox.mockReset().mockResolvedValue([]);
    deleteOutboxEntries.mockReset().mockResolvedValue(undefined);
    applyPulledRows.mockReset().mockResolvedValue(undefined);
    queryClient = new QueryClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('drains the outbox, pushes it, and deletes only the entries the server did not report as failed', async () => {
    drainOutbox.mockResolvedValue([
      { id: 1, tableName: 'customers', op: 'upsert', entityId: 'c1', payloadJson: JSON.stringify({ id: 'c1', name: 'Ravi' }), clientUpdatedAt: '2026-07-24T00:00:00.000Z' },
      { id: 2, tableName: 'customers', op: 'upsert', entityId: 'c2', payloadJson: JSON.stringify({ id: 'c2', name: 'Meera' }), clientUpdatedAt: '2026-07-24T00:00:00.000Z' },
    ]);

    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (String(url).includes('/sync/push')) {
        const body = JSON.parse(opts!.body as string);
        expect(body.entries).toHaveLength(2);
        expect(body.entries[0]).toMatchObject({ table: 'customers', op: 'upsert', id: 'c1', payload: { name: 'Ravi' } });
        return new Response(JSON.stringify({ ok: true, failed: [{ id: 'c2', table: 'customers', error: 'transient' }] }), { status: 200 });
      }
      return new Response(JSON.stringify(emptyPull), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const stop = startSyncEngine('test-token', queryClient);
    await vi.waitFor(() => {
      expect(deleteOutboxEntries).toHaveBeenCalled();
    });
    stop();

    // Only the non-failed entry (id 1, "c1") should be deleted -- "c2" stays
    // queued for retry, mirroring apps/web's syncEngine.ts push().
    expect(deleteOutboxEntries).toHaveBeenCalledWith([1]);
  });

  it('applies pulled rows across all thirteen tables via a single Rust call and advances the cursor', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/sync/push')) return new Response(JSON.stringify({ ok: true, failed: [] }), { status: 200 });
      return new Response(
        JSON.stringify({
          ...emptyPull,
          customers: [{ id: 'c1', name: 'Ravi', phone: '', updatedAt: '2026-07-24T00:00:00.000Z', deletedAt: null }],
          categories: [{ id: 'cat-1', name: '8-Ball', billingType: 'time' }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const stop = startSyncEngine('test-token', queryClient);
    await vi.waitFor(() => {
      expect(localStorage.getItem(CURSOR_KEY)).toBe('2026-07-24T00:00:00.000Z');
    });
    stop();

    // categories before customers -- TABLES is dependency-ordered so a
    // fresh/empty local db never applies a row before the table it
    // references (see syncEngine.ts's TABLES comment).
    expect(applyPulledRows).toHaveBeenCalledWith([
      { table: 'categories', row: { id: 'cat-1', name: '8-Ball', billingType: 'time' } },
      { table: 'customers', row: { id: 'c1', name: 'Ravi', phone: '', updatedAt: '2026-07-24T00:00:00.000Z', deletedAt: null } },
    ]);
  });

  it('does not run a sync cycle when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const stop = startSyncEngine('test-token', queryClient);
    await new Promise(r => setTimeout(r, 10));
    stop();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(drainOutbox).not.toHaveBeenCalled();
  });

  it('recovers from an expired access token: refreshes and retries the cycle', async () => {
    drainOutbox.mockResolvedValue([
      { id: 1, tableName: 'customers', op: 'upsert', entityId: 'c1', payloadJson: JSON.stringify({ id: 'c1', name: 'Ravi' }), clientUpdatedAt: '2026-07-24T00:00:00.000Z' },
    ]);
    const authHeaders: (string | undefined)[] = [];
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const auth = (opts?.headers as Record<string, string> | undefined)?.Authorization;
      if (String(url).includes('/sync/push')) {
        authHeaders.push(auth);
        if (auth === 'Bearer expired-token') {
          return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true, failed: [] }), { status: 200 });
      }
      return new Response(JSON.stringify(emptyPull), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const refreshAccessToken = vi.fn(async () => 'fresh-token');
    const stop = startSyncEngine('expired-token', queryClient, refreshAccessToken);
    await vi.waitFor(() => {
      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    });
    stop();

    expect(authHeaders[0]).toBe('Bearer expired-token');
    expect(authHeaders).toContain('Bearer fresh-token');
  });
});
