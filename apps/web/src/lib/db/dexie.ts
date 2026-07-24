import Dexie, { type Table } from 'dexie';
import type { Session } from '@/lib/shared';
import type { Expense } from '@/lib/shared';
import type { Customer } from '@/lib/shared';
import type { CreditEntry } from '@/lib/shared';
import type { OutboxEntry } from '@/lib/shared';

export interface RateRow {
  category: string;
  hour: number | null;
  half: number | null;
  value: number | null;
  updatedAt: string;
}

export interface OutboxRow extends OutboxEntry {
  outboxId?: number;
}

export class CueRoomDB extends Dexie {
  sessions!: Table<Session, string>;
  expenses!: Table<Expense, string>;
  customers!: Table<Customer, string>;
  creditEntries!: Table<CreditEntry, string>;
  rates!: Table<RateRow, string>;
  outbox!: Table<OutboxRow, number>;

  constructor() {
    super('cue-room');
    this.version(1).stores({
      sessions: 'id, date, category, resource, customerId, updatedAt',
      expenses: 'id, date, updatedAt',
      customers: 'id, name, updatedAt',
      creditEntries: 'id, customerId, date, updatedAt',
      rates: 'category, updatedAt',
      outbox: '++outboxId, table, id',
    });
  }
}

export const db = new CueRoomDB();

export async function enqueueOutbox(
  table: OutboxRow['table'],
  op: OutboxRow['op'],
  id: string,
  payload: Record<string, unknown>
): Promise<void> {
  await db.outbox.add({ table, op, id, payload, clientUpdatedAt: new Date().toISOString() });
}
