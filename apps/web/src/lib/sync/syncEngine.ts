import type { Table } from 'dexie';
import { db, type RateRow } from '../db/dexie';
import { apiFetch } from '../api/client';
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
