import Dexie, { type Table } from 'dexie';
import type { Session } from '@/lib/shared';
import type { Expense } from '@/lib/shared';
import type { Customer } from '@/lib/shared';
import type { CreditEntry } from '@/lib/shared';
import type { OutboxEntry } from '@/lib/shared';
import type { Billing } from '@/lib/shared';

export interface CategoryRow {
  id: string;
  name: string;
  billingType: Billing;
}

export interface StationRow {
  id: string;
  categoryId: string;
  name: string;
}

export interface RateRow {
  id: string;
  categoryId: string;
  hour: number | null;
  half: number | null;
  value: number | null;
  updatedAt: string;
}

export interface OutboxRow extends OutboxEntry {
  outboxId?: number;
}

export class CueRoomDB extends Dexie {
  categories!: Table<CategoryRow, string>;
  stations!: Table<StationRow, string>;
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
    // v2: categories/stations become real synced tables (see apps/api's
    // relational schema migration); sessions key by stationId instead of
    // flat category/resource strings, and rates key by their own id instead
    // of category name. No upgrade() migration function is written for the
    // v1 -> v2 data shape change -- there are no real end users yet, and the
    // app's first-run bootstrap pull (App.tsx) repopulates everything from
    // the server on next login regardless.
    this.version(2).stores({
      categories: 'id, name',
      stations: 'id, categoryId, name',
      sessions: 'id, date, stationId, customerId, updatedAt',
      expenses: 'id, date, updatedAt',
      customers: 'id, name, updatedAt',
      creditEntries: 'id, customerId, date, updatedAt',
      rates: 'id, categoryId, updatedAt',
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
