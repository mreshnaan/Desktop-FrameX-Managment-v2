import type { Table } from 'dexie';
import type { QueryClient } from '@tanstack/react-query';
import { db, type RateRow, type CategoryRow, type StationRow } from '../db/dexie';
import { apiFetch, ApiError } from '../api/client';
import type { Session, Expense, Customer, CreditEntry } from '@/lib/shared';

const CURSOR_KEY = 'cue-room-sync-cursor';
// Dexie/IndexedDB doesn't enforce foreign keys, so this ordering isn't
// functionally required here the way it is for apps/desktop's SQLite --
// kept dependency-ordered anyway for consistency with that fix (categories
// before stations/rates, which reference it).
const TABLES = ['categories', 'stations', 'rates', 'sessions', 'expenses', 'customers', 'creditEntries'] as const;

// categories/stations have no updatedAt column (server-seeded reference data,
// no client ever edits them -- see apps/api's schema migration) so
// last-write-wins doesn't apply to them; every pull just overwrites the
// local copy unconditionally.
const ALWAYS_OVERWRITE_TABLES = new Set<(typeof TABLES)[number]>(['categories', 'stations']);

interface TableRowMap {
  sessions: Session;
  expenses: Expense;
  customers: Customer;
  creditEntries: CreditEntry;
  rates: RateRow;
  categories: CategoryRow;
  stations: StationRow;
}

interface PullResult {
  sessions: Session[];
  expenses: Expense[];
  customers: Customer[];
  creditEntries: CreditEntry[];
  rates: RateRow[];
  categories: CategoryRow[];
  stations: StationRow[];
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
  const alwaysOverwrite = ALWAYS_OVERWRITE_TABLES.has(table);
  for (const row of rows) {
    const key = (row as { id: string }).id;
    if (alwaysOverwrite) {
      await dexieTable.put(row);
      continue;
    }
    const existing = await dexieTable.get(key);
    const incomingUpdatedAt = (row as { updatedAt?: string }).updatedAt ?? 0;
    const existingUpdatedAt = (existing as { updatedAt?: string } | undefined)?.updatedAt ?? 0;
    if (!existing || new Date(incomingUpdatedAt) > new Date(existingUpdatedAt)) {
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

// Runs one pull cycle (no push -- a fresh install has nothing local to push
// yet) and lets its error propagate, so the caller (App.tsx's first-run
// gate) can block rendering the main app shell until categories/stations/
// rates are actually populated, instead of silently swallowing failures the
// way the background cycle() below does.
export async function runBootstrapPull(accessToken: string): Promise<void> {
  await pull(accessToken);
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
