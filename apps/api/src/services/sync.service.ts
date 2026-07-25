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

export interface Actor {
  id: string;
  name: string;
}

type TxClient = Prisma.TransactionClient;

// Builds the ActivityLog's one-line human-readable summary from whatever
// the client already sent in the payload -- no extra DB lookups (a
// category/customer/product name is always present on its own row's
// payload; cross-entity context like "which category is this station in"
// isn't worth a join just for a log line).
function summarize(table: OutboxEntry['table'], payload: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  switch (table) {
    case 'categories':
      return `category "${str(payload.name)}"`;
    case 'stations':
      return `station "${str(payload.name)}"`;
    case 'sessions':
      return `session on ${str(payload.date)} — ₹${num(payload.amount)}`;
    case 'expenses':
      return `expense "${str(payload.description)}" — ₹${num(payload.amount)}`;
    case 'customers':
      return `customer "${str(payload.name)}"`;
    case 'creditEntries':
      return `${str(payload.type) === 'CREDIT_GIVEN' ? 'credit given' : 'payment received'} — ₹${num(payload.amount)}`;
    case 'rates':
      return `rate (₹${num(payload.hour ?? payload.value)})`;
    case 'productCategories':
      return `product category "${str(payload.name)}"`;
    case 'products':
      return `product "${str(payload.name)}" — ₹${num(payload.price)}`;
    case 'orders':
      return `order — ₹${num(payload.total)} (${str(payload.method)})`;
    case 'orderItems':
      return `order item — qty ${num(payload.qty)}`;
    case 'stockMovements':
      return `stock movement (${num(payload.delta) > 0 ? '+' : ''}${num(payload.delta)}, ${str(payload.reason)})`;
  }
}

// Append-only ledgers (an order line, a stock movement, a credit entry, a
// checked-out order) have no createdBy/updatedBy update path -- only the
// create-time stamp exists, so `updatedBy` is never written for these.
const APPEND_ONLY_TABLES = new Set<OutboxEntry['table']>(['creditEntries', 'orders', 'orderItems', 'stockMovements']);

async function applyEntry(tx: TxClient, entry: OutboxEntry, now: Date, actor?: Actor): Promise<void> {
  const isDelete = entry.op === 'delete';
  const stampCreate = actor ? { createdBy: actor.id, updatedBy: actor.id } : {};
  const stampUpdate = actor ? (APPEND_ONLY_TABLES.has(entry.table) ? {} : { updatedBy: actor.id }) : {};
  // A client's payload may itself carry createdBy/updatedBy (desktop always
  // includes them; see current_actor.rs) -- stripped here so they can never
  // leak through as stale/client-asserted values on an update. createdBy/
  // updatedBy are exclusively server-derived, via stampCreate/stampUpdate
  // above.
  const { createdBy: _clientCreatedBy, updatedBy: _clientUpdatedBy, ...payload } = entry.payload;

  // Existence check up front: every write below is an upsert (a client's
  // outbox entry doesn't distinguish "this id already exists on the
  // server" from "it doesn't" -- two devices can each create the same
  // locally-generated id independently), so this is the only way to know
  // whether to log the entry as a create or an update.
  const existed = await entryExists(tx, entry.table, entry.id);
  const action = isDelete ? 'delete' : existed ? 'update' : 'create';

  switch (entry.table) {
    case 'customers': {
      const base = { ...payload, updatedAt: now, deletedAt: isDelete ? now : null, ...stampUpdate };
      await tx.customer.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.CustomerUncheckedCreateInput,
        update: base as unknown as Prisma.CustomerUncheckedUpdateInput,
      });
      break;
    }
    case 'sessions': {
      const base = { ...payload, updatedAt: now, deletedAt: isDelete ? now : null, ...stampUpdate };
      await tx.session.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.SessionUncheckedCreateInput,
        update: base as unknown as Prisma.SessionUncheckedUpdateInput,
      });
      break;
    }
    case 'expenses': {
      const base = { ...payload, updatedAt: now, deletedAt: isDelete ? now : null, ...stampUpdate };
      await tx.expense.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.ExpenseUncheckedCreateInput,
        update: base as unknown as Prisma.ExpenseUncheckedUpdateInput,
      });
      break;
    }
    case 'creditEntries': {
      // CreditEntry has no deletedAt column — deletes are not soft-deletable here, only updatedAt is stamped.
      const base = { ...payload, updatedAt: now };
      await tx.creditEntry.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.CreditEntryUncheckedCreateInput,
        update: base as unknown as Prisma.CreditEntryUncheckedUpdateInput,
      });
      break;
    }
    case 'rates': {
      // Rate has no deletedAt column and is keyed by `id`, not `categoryId`.
      const base = { ...payload, updatedAt: now, ...stampUpdate };
      await tx.rate.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.RateUncheckedCreateInput,
        update: base as unknown as Prisma.RateUncheckedUpdateInput,
      });
      break;
    }
    case 'categories': {
      // No client ever pushes a categories/stations entry today (they're
      // seeded server-side and have no CRUD UI), but the server still handles
      // upserts uniformly with every other table rather than special-casing
      // "unreachable" — leaves room for an admin UI later without another
      // sync-service change.
      const base = { ...payload, ...stampUpdate };
      await tx.category.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.CategoryUncheckedCreateInput,
        update: base as unknown as Prisma.CategoryUncheckedUpdateInput,
      });
      break;
    }
    case 'stations': {
      const base = { ...payload, ...stampUpdate };
      await tx.station.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.StationUncheckedCreateInput,
        update: base as unknown as Prisma.StationUncheckedUpdateInput,
      });
      break;
    }
    case 'productCategories': {
      // No CRUD UI pushes these except the desktop admin's product-management
      // screen (mirrors categories/stations).
      const base = { ...payload, ...stampUpdate };
      await tx.productCategory.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.ProductCategoryUncheckedCreateInput,
        update: base as unknown as Prisma.ProductCategoryUncheckedUpdateInput,
      });
      break;
    }
    case 'products': {
      const base = { ...payload, updatedAt: now, deletedAt: isDelete ? now : null, ...stampUpdate };
      await tx.product.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.ProductUncheckedCreateInput,
        update: base as unknown as Prisma.ProductUncheckedUpdateInput,
      });
      break;
    }
    case 'orders': {
      const base = { ...payload, updatedAt: now, deletedAt: isDelete ? now : null };
      await tx.order.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.OrderUncheckedCreateInput,
        update: base as unknown as Prisma.OrderUncheckedUpdateInput,
      });
      break;
    }
    case 'orderItems': {
      // Immutable line items -- no deletedAt, order rows are never edited
      // after creation.
      const base = { ...payload, updatedAt: now };
      await tx.orderItem.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base } as unknown as Prisma.OrderItemUncheckedCreateInput,
        update: base as unknown as Prisma.OrderItemUncheckedUpdateInput,
      });
      break;
    }
    case 'stockMovements': {
      const base = { ...payload, updatedAt: now };
      await tx.stockMovement.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.StockMovementUncheckedCreateInput,
        update: base as unknown as Prisma.StockMovementUncheckedUpdateInput,
      });
      break;
    }
  }

  if (actor) {
    await tx.activityLog.create({
      data: {
        userId: actor.id,
        userName: actor.name,
        action,
        tableName: entry.table,
        entityId: entry.id,
        summary: `${action === 'create' ? 'Created' : action === 'delete' ? 'Deleted' : 'Updated'} ${summarize(entry.table, entry.payload)}`,
      },
    });
  }
}

async function entryExists(tx: TxClient, table: OutboxEntry['table'], id: string): Promise<boolean> {
  switch (table) {
    case 'customers':
      return (await tx.customer.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'sessions':
      return (await tx.session.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'expenses':
      return (await tx.expense.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'creditEntries':
      return (await tx.creditEntry.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'rates':
      return (await tx.rate.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'categories':
      return (await tx.category.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'stations':
      return (await tx.station.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'productCategories':
      return (await tx.productCategory.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'products':
      return (await tx.product.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'orders':
      return (await tx.order.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'orderItems':
      return (await tx.orderItem.findUnique({ where: { id }, select: { id: true } })) !== null;
    case 'stockMovements':
      return (await tx.stockMovement.findUnique({ where: { id }, select: { id: true } })) !== null;
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
//
// The ActivityLog row for a given entry is written inside that SAME
// per-entry transaction, so a failed entry never produces a log row for
// a write that didn't actually happen.
export async function applyPush(entries: OutboxEntry[], actorUserId?: string): Promise<ApplyPushResult> {
  const failed: PushFailure[] = [];
  const actor = await resolveActor(actorUserId);

  for (const entry of entries) {
    const now = new Date();
    try {
      await prisma.$transaction((tx) => applyEntry(tx, entry, now, actor));
    } catch (err) {
      failed.push({
        id: entry.id,
        table: entry.table,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  await prisma.syncLog.create({
    data: {
      userId: actor?.id,
      userName: actor?.name,
      direction: 'push',
      entryCount: entries.length,
      failedCount: failed.length,
      errorSummary: failed.length > 0 ? failed.map((f) => `${f.table}:${f.id} — ${f.error}`).join('; ').slice(0, 500) : null,
    },
  });

  return { failed };
}

async function resolveActor(userId?: string): Promise<Actor | undefined> {
  if (!userId) return undefined;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
  return user ?? undefined;
}

export async function pullSince(since?: string, actorUserId?: string) {
  const where = since ? { updatedAt: { gt: new Date(since) } } : {};
  // categories/stations have no updatedAt column (see schema migration note --
  // they're stable, server-seeded reference data with no client-side edits),
  // so every pull returns the full set rather than filtering by `since`.
  const [
    sessions, expenses, customers, creditEntries, rates, categories, stations,
    productCategories, products, orders, orderItems, stockMovements,
  ] = await Promise.all([
    prisma.session.findMany({ where }),
    prisma.expense.findMany({ where }),
    prisma.customer.findMany({ where }),
    prisma.creditEntry.findMany({ where }),
    prisma.rate.findMany({ where }),
    prisma.category.findMany(),
    prisma.station.findMany(),
    prisma.productCategory.findMany(),
    prisma.product.findMany({ where }),
    prisma.order.findMany({ where }),
    prisma.orderItem.findMany({ where }),
    prisma.stockMovement.findMany({ where }),
  ]);

  const actor = await resolveActor(actorUserId);
  const entryCount =
    sessions.length + expenses.length + customers.length + creditEntries.length + rates.length +
    categories.length + stations.length + productCategories.length + products.length +
    orders.length + orderItems.length + stockMovements.length;
  await prisma.syncLog.create({
    data: { userId: actor?.id, userName: actor?.name, direction: 'pull', entryCount },
  });

  return {
    sessions,
    expenses,
    customers,
    creditEntries,
    rates,
    categories,
    stations,
    productCategories,
    products,
    orders,
    orderItems,
    stockMovements,
    serverTime: new Date().toISOString(),
  };
}
