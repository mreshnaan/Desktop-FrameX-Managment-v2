import { db } from '../db/dexie';
import { apiFetch } from '../api/client';

const CURSOR_KEY = 'cue-room-sync-cursor';
const TABLES = ['sessions', 'expenses', 'customers', 'creditEntries', 'rates'] as const;

interface PullResult {
  sessions: any[];
  expenses: any[];
  customers: any[];
  creditEntries: any[];
  rates: any[];
  serverTime: string;
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
  await apiFetch('/sync/push', { method: 'POST', accessToken, body: JSON.stringify({ entries }) });
  await db.outbox.bulkDelete(pending.map((p) => p.outboxId!));
}

async function mergeIncoming(table: (typeof TABLES)[number], rows: any[]) {
  const dexieTable = (db as any)[table];
  for (const row of rows) {
    const key = table === 'rates' ? row.category : row.id;
    const existing = await dexieTable.get(key);
    if (!existing || new Date(row.updatedAt) > new Date(existing.updatedAt)) {
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

export function startSyncEngine(accessToken: string): () => void {
  let stopped = false;
  async function cycle() {
    if (stopped || !navigator.onLine) return;
    try {
      await push(accessToken);
      await pull(accessToken);
    } catch (e) {
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
