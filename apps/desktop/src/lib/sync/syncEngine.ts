import type { QueryClient } from '@tanstack/react-query';
import { commands, type PulledRow } from '../tauri/commands';
import { apiFetch, ApiError } from '../api/client';

const CURSOR_KEY = 'cue-room-desktop-sync-cursor';
// Order matters: SQLite enforces foreign keys, so a table must be applied
// strictly after every table it references (categories/stations first;
// orderItems/stockMovements last), or a fresh install's bootstrap pull fails.
const TABLES = [
  'categories', 'stations', 'rates', 'offers',
  'customers', 'sessions', 'expenses', 'creditEntries',
  'productCategories', 'products', 'orders', 'orderItems', 'stockMovements',
] as const;

interface PullResult {
  sessions: unknown[];
  expenses: unknown[];
  customers: unknown[];
  creditEntries: unknown[];
  rates: unknown[];
  offers: unknown[];
  categories: unknown[];
  stations: unknown[];
  productCategories: unknown[];
  products: unknown[];
  orders: unknown[];
  orderItems: unknown[];
  stockMovements: unknown[];
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
  const pending = await commands.drainOutbox();
  if (pending.length === 0) return;

  const entries = pending.map(p => ({
    table: p.tableName,
    op: p.op,
    id: p.entityId,
    payload: JSON.parse(p.payloadJson) as Record<string, unknown>,
    clientUpdatedAt: p.clientUpdatedAt,
  }));

  const result = await apiFetch<PushResult>('/sync/push', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ entries }),
  });

  // Only clear outbox rows the server actually applied -- failed entries stay for retry.
  const failedKeys = new Set((result.failed ?? []).map(f => `${f.table}:${f.id}`));
  const idsToDelete = pending
    .filter(p => !failedKeys.has(`${p.tableName}:${p.entityId}`))
    .map(p => p.id);
  if (idsToDelete.length > 0) await commands.deleteOutboxEntries(idsToDelete);
}

async function pull(accessToken: string) {
  const since = localStorage.getItem(CURSOR_KEY) ?? undefined;
  const result = await apiFetch<PullResult>(`/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`, {
    accessToken,
  });

  const rows: PulledRow[] = [];
  for (const table of TABLES) {
    for (const row of result[table]) rows.push({ table, row: row as Record<string, unknown> });
  }
  if (rows.length > 0) await commands.applyPulledRows(rows);

  localStorage.setItem(CURSOR_KEY, result.serverTime);
}

// Runs one pull cycle (no push -- nothing local to push on a fresh install)
// so App.tsx's first-run gate can block rendering until data is populated.
export async function runBootstrapPull(accessToken: string): Promise<void> {
  await pull(accessToken);
}

export function startSyncEngine(
  accessToken: string,
  queryClient: QueryClient,
  refreshAccessToken?: () => Promise<string | null>,
): () => void {
  let stopped = false;

  async function runOnce(token: string) {
    await push(token);
    await pull(token);
    await queryClient.invalidateQueries();
  }

  async function cycle() {
    if (stopped || !navigator.onLine) return;
    try {
      await runOnce(accessToken);
    } catch (e) {
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
