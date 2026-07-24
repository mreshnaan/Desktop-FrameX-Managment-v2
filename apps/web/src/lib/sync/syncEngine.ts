import type { Table } from 'dexie';
import type { QueryClient } from '@tanstack/react-query';
import { db, type RateRow } from '../db/dexie';
import { apiFetch, ApiError } from '../api/client';
import type { Session, Expense, Customer, CreditEntry } from '@/lib/shared';

const CURSOR_KEY = 'cue-room-sync-cursor';
const TABLES = ['sessions', 'expenses', 'customers', 'creditEntries', 'rates'] as const;

interface TableRowMap {
  sessions: Session;
  expenses: Expense;
  customers: Customer;
  creditEntries: CreditEntry;
  rates: RateRow;
}

interface PullResult {
  sessions: Session[];
  expenses: Expense[];
  customers: Customer[];
  creditEntries: CreditEntry[];
  rates: RateRow[];
  serverTime: string;
}

interface PushFailure {
  id: string;
  table: string;
  error: string;
}

interface PushResult {
  ok: true;
  failed: PushFailure[];
}

async function push(accessToken: string) {
  const pending = await db.outbox.toArray();
  if (pending.length === 0) return;
  const entries = pending.map((p) => ({
    table: p.table,
    op: p.op,
    id: p.id,
    payload: p.payload,
    clientUpdatedAt: p.clientUpdatedAt,
  }));
  const result = await apiFetch<PushResult>('/sync/push', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ entries }),
  });
  // Only clear outbox rows the server actually applied. Entries reported in
  // `failed` (e.g. a transient DB blip on one upsert) must stay in the
  // outbox so the next 30s cycle retries them -- deleting them unconditionally
  // on any 200 would silently and permanently lose that entry's data.
  const failedKeys = new Set((result.failed ?? []).map((f) => `${f.table}:${f.id}`));
  const toDelete = pending.filter((p) => !failedKeys.has(`${p.table}:${p.id}`));
  await db.outbox.bulkDelete(toDelete.map((p) => p.outboxId!));
}

async function mergeIncoming<K extends keyof TableRowMap>(table: K, rows: TableRowMap[K][]) {
  const dexieTable = db[table] as Table<TableRowMap[K], string>;
  for (const row of rows) {
    const key = table === 'rates' ? (row as RateRow).category : (row as { id: string }).id;
    const existing = await dexieTable.get(key);
    if (!existing || new Date(row.updatedAt ?? 0) > new Date(existing.updatedAt ?? 0)) {
      await dexieTable.put(row);
    }
  }
}

async function pull(accessToken: string) {
  const since = localStorage.getItem(CURSOR_KEY) ?? undefined;
  const result = await apiFetch<PullResult>(`/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`, {
    accessToken,
  });
  for (const table of TABLES) await mergeIncoming(table, result[table]);
  localStorage.setItem(CURSOR_KEY, result.serverTime);
}

export function startSyncEngine(
  accessToken: string,
  queryClient: QueryClient,
  // Called when a cycle fails with a 401 (expired access token). Returns a
  // fresh access token, or null if the refresh token itself is gone/expired
  // (in which case the app logs the user out). Optional so that older callers
  // and tests that don't need recovery keep working unchanged.
  refreshAccessToken?: () => Promise<string | null>,
): () => void {
  let stopped = false;

  async function runOnce(token: string) {
    await push(token);
    await pull(token);
    // mergeIncoming() above writes straight into Dexie -- it doesn't go
    // through any of the addX/updateX hook functions, so nothing has told
    // React Query that the underlying data changed. Every local mutation
    // hook (useCustomers, useSessions, useExpenses, ...) calls
    // invalidateQueries() itself after writing, but incoming sync data
    // has no equivalent caller, so without this the UI would silently
    // never reflect changes pulled from another device until an
    // unrelated action happened to refetch the same query.
    await queryClient.invalidateQueries();
  }

  async function cycle() {
    if (stopped || !navigator.onLine) return;
    try {
      await runOnce(accessToken);
    } catch (e) {
      // An expired access token (15 min after login) surfaces here as a 401.
      // Without recovery, sync would silently die for the rest of the shift.
      // Refresh the token and retry the cycle once with the new one. Updating
      // AuthContext state inside refreshAccessToken also restarts this engine
      // (App.tsx useEffect keyed on accessToken), so a fresh engine takes over
      // with the new token -- the internal retry just makes recovery immediate
      // and independently testable.
      if (e instanceof ApiError && e.status === 401 && refreshAccessToken) {
        const fresh = await refreshAccessToken();
        if (fresh && !stopped) {
          try {
            await runOnce(fresh);
          } catch (retryErr) {
            console.warn('sync cycle failed after token refresh', retryErr);
          }
        }
        return;
      }
      console.warn('sync cycle failed', e);
    }
  }
  const interval = setInterval(cycle, 30_000);
  const onOnline = () => cycle();
  window.addEventListener('online', onOnline);
  cycle();
  return () => {
    stopped = true;
    clearInterval(interval);
    window.removeEventListener('online', onOnline);
  };
}
