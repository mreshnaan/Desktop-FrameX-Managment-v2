import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db, enqueueOutbox } from '../lib/db/dexie';
import { startSyncEngine } from '../lib/sync/syncEngine';

const CURSOR_KEY = 'cue-room-sync-cursor';

describe('syncEngine', () => {
  beforeEach(async () => {
    await db.outbox.clear();
    await db.customers.clear();
    localStorage.removeItem(CURSOR_KEY);
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pushes pending outbox entries with the correct request body and clears them only after a successful push', async () => {
    const id = crypto.randomUUID();
    await enqueueOutbox('customers', 'upsert', id, { id, name: 'Ravi' });
    const pendingBefore = await db.outbox.toArray();
    expect(pendingBefore).toHaveLength(1);

    const calls: { url: string; body?: string }[] = [];
    const fetchMock = vi.fn(async (url: string, opts: RequestInit) => {
      calls.push({ url: String(url), body: opts?.body as string | undefined });
      if (String(url).includes('/sync/push')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      // /sync/pull
      return new Response(
        JSON.stringify({ sessions: [], expenses: [], customers: [], creditEntries: [], rates: [], serverTime: '2026-07-24T00:00:00.000Z' }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const stop = startSyncEngine('test-token');
    // cycle() runs async fire-and-forget inside startSyncEngine; wait for it to settle.
    await vi.waitFor(async () => {
      const remaining = await db.outbox.toArray();
      expect(remaining).toHaveLength(0);
    });
    stop();

    const pushCall = calls.find((c) => c.url.includes('/sync/push'));
    expect(pushCall).toBeDefined();
    const body = JSON.parse(pushCall!.body!);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ table: 'customers', op: 'upsert', id, payload: { id, name: 'Ravi' } });

    expect(localStorage.getItem(CURSOR_KEY)).toBe('2026-07-24T00:00:00.000Z');
  });

  it('does not clear the outbox when the push request fails', async () => {
    const id = crypto.randomUUID();
    await enqueueOutbox('customers', 'upsert', id, { id, name: 'Ravi' });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/sync/push')) {
        return new Response(JSON.stringify({ error: 'server down' }), { status: 500 });
      }
      return new Response(JSON.stringify({ sessions: [], expenses: [], customers: [], creditEntries: [], rates: [], serverTime: '2026-07-24T00:00:00.000Z' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const stop = startSyncEngine('test-token');
    // Give the fire-and-forget cycle() a tick to run and fail.
    await new Promise((r) => setTimeout(r, 10));
    stop();

    const remaining = await db.outbox.toArray();
    expect(remaining).toHaveLength(1);
    // pull must not have run (and cursor must not advance) since push failed first.
    expect(localStorage.getItem(CURSOR_KEY)).toBeNull();
  });

  it('applies last-write-wins on pull: skips incoming rows older than the local row, applies newer ones', async () => {
    const id = crypto.randomUUID();
    await db.customers.put({ id, name: 'Local Name', phone: '', updatedAt: '2026-07-20T00:00:00.000Z', deletedAt: null });

    const id2 = crypto.randomUUID();
    await db.customers.put({ id: id2, name: 'Stale Local', phone: '', updatedAt: '2026-07-22T00:00:00.000Z', deletedAt: null });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/sync/push')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          sessions: [],
          expenses: [],
          customers: [
            // newer than local -> should overwrite
            { id, name: 'Server Newer', phone: '', updatedAt: '2026-07-23T00:00:00.000Z', deletedAt: null },
            // older than local -> should be skipped
            { id: id2, name: 'Server Older', phone: '', updatedAt: '2026-07-21T00:00:00.000Z', deletedAt: null },
          ],
          creditEntries: [],
          rates: [],
          serverTime: '2026-07-24T00:00:00.000Z',
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const stop = startSyncEngine('test-token');
    await vi.waitFor(() => {
      expect(localStorage.getItem(CURSOR_KEY)).toBe('2026-07-24T00:00:00.000Z');
    });
    stop();

    const row1 = await db.customers.get(id);
    const row2 = await db.customers.get(id2);
    expect(row1?.name).toBe('Server Newer');
    expect(row2?.name).toBe('Stale Local');
  });

  it('does not run a sync cycle when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const id = crypto.randomUUID();
    await enqueueOutbox('customers', 'upsert', id, { id, name: 'Ravi' });

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const stop = startSyncEngine('test-token');
    await new Promise((r) => setTimeout(r, 10));
    stop();

    expect(fetchMock).not.toHaveBeenCalled();
    const remaining = await db.outbox.toArray();
    expect(remaining).toHaveLength(1);
  });

  it('returns a cleanup function that stops the interval and removes the online listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));

    const stop = startSyncEngine('test-token');
    expect(addSpy).toHaveBeenCalledWith('online', expect.any(Function));
    const onlineHandler = addSpy.mock.calls.find((c) => c[0] === 'online')?.[1];

    stop();
    expect(removeSpy).toHaveBeenCalledWith('online', onlineHandler);
  });
});
