import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { OutboxEntry } from '../shared/index';

export interface PushFailure {
  id: string;
  table: string;
  error: string;
}

export interface ApplyPushResult {
  failed: PushFailure[];
}

type TxClient = Prisma.TransactionClient;

async function applyEntry(tx: TxClient, entry: OutboxEntry, now: Date): Promise<void> {
  const isDelete = entry.op === 'delete';

  switch (entry.table) {
    case 'customers': {
      const base = { ...entry.payload, updatedAt: now, deletedAt: isDelete ? now : null };
      await tx.customer.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base } as unknown as Prisma.CustomerUncheckedCreateInput,
        update: base as unknown as Prisma.CustomerUncheckedUpdateInput,
      });
      break;
    }
    case 'sessions': {
      const base = { ...entry.payload, updatedAt: now, deletedAt: isDelete ? now : null };
      await tx.session.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base } as unknown as Prisma.SessionUncheckedCreateInput,
        update: base as unknown as Prisma.SessionUncheckedUpdateInput,
      });
      break;
    }
    case 'expenses': {
      const base = { ...entry.payload, updatedAt: now, deletedAt: isDelete ? now : null };
      await tx.expense.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base } as unknown as Prisma.ExpenseUncheckedCreateInput,
        update: base as unknown as Prisma.ExpenseUncheckedUpdateInput,
      });
      break;
    }
    case 'creditEntries': {
      // CreditEntry has no deletedAt column — deletes are not soft-deletable here, only updatedAt is stamped.
      const base = { ...entry.payload, updatedAt: now };
      await tx.creditEntry.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base } as unknown as Prisma.CreditEntryUncheckedCreateInput,
        update: base as unknown as Prisma.CreditEntryUncheckedUpdateInput,
      });
      break;
    }
    case 'rates': {
      // Rate has no deletedAt column and is keyed by `category`, not `id`.
      const base = { ...entry.payload, updatedAt: now };
      await tx.rate.upsert({
        where: { category: entry.id },
        create: { category: entry.id, ...base } as unknown as Prisma.RateUncheckedCreateInput,
        update: base as unknown as Prisma.RateUncheckedUpdateInput,
      });
      break;
    }
  }
}

// Applies a batch of client outbox entries.
//
// Design note -- transaction PER ENTRY, not one shared transaction for the whole
// batch:
//
// The obvious-looking design is a single `prisma.$transaction(async (tx) => {...})`
// wrapping the whole loop, with a try/catch around each entry inside it so one bad
// entry can't blow up the others. That does NOT work with Postgres. This was
// verified directly (not assumed): once any statement inside a Postgres
// transaction errors, the server marks the *entire* transaction as aborted
// (SQLSTATE 25P02, "current transaction is aborted, commands ignored until end of
// transaction block") and rejects every subsequent statement in that transaction,
// even if the application already caught and swallowed the first error. So a
// single shared transaction cannot give true per-entry isolation -- the first bad
// entry would silently take out every entry after it in the same batch.
//
// Transaction-per-entry sidesteps this entirely: each entry's write is wrapped in
// its own `prisma.$transaction`, so it commits or rolls back independently.
//   - Atomicity: a single entry here is one upsert, already atomic on its own, but
//     wrapping it keeps the shape uniform and safe if an entry ever needs more than
//     one write in future.
//   - Idempotent retries: a failed entry leaves no partial state, so the client can
//     safely retry it later without risk of double-applying part of a write.
//   - Isolation: one entry's failure (and Postgres-side transaction abort) is fully
//     contained to that entry's own transaction and never touches any other entry's
//     transaction, in the same batch or a later retry.
export async function applyPush(entries: OutboxEntry[]): Promise<ApplyPushResult> {
  const failed: PushFailure[] = [];

  for (const entry of entries) {
    const now = new Date();
    try {
      await prisma.$transaction((tx) => applyEntry(tx, entry, now));
    } catch (err) {
      failed.push({
        id: entry.id,
        table: entry.table,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { failed };
}

export async function pullSince(since?: string) {
  const where = since ? { updatedAt: { gt: new Date(since) } } : {};
  const [sessions, expenses, customers, creditEntries, rates] = await Promise.all([
    prisma.session.findMany({ where }),
    prisma.expense.findMany({ where }),
    prisma.customer.findMany({ where }),
    prisma.creditEntry.findMany({ where }),
    prisma.rate.findMany({ where }),
  ]);
  return { sessions, expenses, customers, creditEntries, rates, serverTime: new Date().toISOString() };
}
