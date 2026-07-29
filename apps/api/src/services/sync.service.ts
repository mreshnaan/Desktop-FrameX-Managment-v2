import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { CURRENCY_SYMBOL, type OutboxEntry } from '../shared/index';

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

// Builds the ActivityLog's one-line summary from the payload alone -- no
// extra DB lookups.
function summarize(table: OutboxEntry['table'], payload: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  switch (table) {
    case 'categories':
      return `category "${str(payload.name)}"`;
    case 'stations':
      return `station "${str(payload.name)}"`;
    case 'sessions':
      return `session on ${str(payload.date)} — ${CURRENCY_SYMBOL}${num(payload.amount)}`;
    case 'expenses':
      return `expense "${str(payload.description)}" — ${CURRENCY_SYMBOL}${num(payload.amount)}`;
    case 'customers':
      return `customer "${str(payload.name)}"`;
    case 'creditEntries':
      return `${str(payload.type) === 'CREDIT_GIVEN' ? 'credit given' : 'payment received'} — ${CURRENCY_SYMBOL}${num(payload.amount)}`;
    case 'rates':
      return `rate (${CURRENCY_SYMBOL}${num(payload.hour ?? payload.value)})`;
    case 'offers':
      return `offer "${str(payload.name)}"`;
    case 'productCategories':
      return `product category "${str(payload.name)}"`;
    case 'products':
      return `product "${str(payload.name)}" — ${CURRENCY_SYMBOL}${num(payload.price)}`;
    case 'orders':
      return `order — ${CURRENCY_SYMBOL}${num(payload.total)} (${str(payload.method)})`;
    case 'orderItems':
      return `order item — qty ${num(payload.qty)}`;
    case 'stockMovements':
      return `stock movement (${num(payload.delta) > 0 ? '+' : ''}${num(payload.delta)}, ${str(payload.reason)})`;
  }
}

// Append-only tables have no updatedBy column -- only createdBy is ever stamped.
const APPEND_ONLY_TABLES = new Set<OutboxEntry['table']>(['creditEntries', 'orders', 'orderItems', 'stockMovements']);

// A "delete" outbox entry carries a minimal payload (just id + updatedBy --
// see e.g. do_delete_session in apps/desktop/src-tauri), not a full row.
// upsert() validates the shape of its `create` argument up front, before it
// even checks whether the row exists to decide create-vs-update -- so
// passing that minimal payload as `create` always throws a "required field
// missing" error, on every single retry, regardless of whether the row is
// actually there. A soft-delete only ever needs to update, so route it
// through update() instead; if the row was never pushed (or this is a
// stale retry after it's already gone), update() throws Prisma's P2025
// "record not found", which is a no-op here -- the desired end state
// (deleted / absent) already holds.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma's
// per-model delegate types are individually too strict to unify here (same
// reason the call sites below already cast through `unknown`); `any` keeps
// this one helper honest about being a deliberately loose bridge.
async function upsertOrSoftDelete(
  delegate: { upsert: (args: any) => Promise<unknown>; update: (args: any) => Promise<unknown> },
  id: string,
  isDelete: boolean,
  createData: unknown,
  updateData: unknown,
): Promise<void> {
  if (isDelete) {
    try {
      await delegate.update({ where: { id }, data: updateData });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return;
      throw err;
    }
    return;
  }
  await delegate.upsert({ where: { id }, create: createData, update: updateData });
}

async function applyEntry(tx: TxClient, entry: OutboxEntry, now: Date, actor?: Actor): Promise<void> {
  const isDelete = entry.op === 'delete';
  const stampCreate = actor
    ? APPEND_ONLY_TABLES.has(entry.table)
      ? { createdBy: actor.id }
      : { createdBy: actor.id, updatedBy: actor.id }
    : {};
  const stampUpdate = actor ? (APPEND_ONLY_TABLES.has(entry.table) ? {} : { updatedBy: actor.id }) : {};
  // createdBy/updatedBy are server-derived only -- strip any client-sent
  // values so they can't leak through as stale data on an update.
  const { createdBy: _clientCreatedBy, updatedBy: _clientUpdatedBy, ...payload } = entry.payload;

  // Every write below is an upsert (two devices can create the same locally
  // generated id independently), so this is the only way to log create vs update.
  const existed = await entryExists(tx, entry.table, entry.id);
  const action = isDelete ? 'delete' : existed ? 'update' : 'create';

  switch (entry.table) {
    case 'customers': {
      const base = { ...payload, updatedAt: now, deletedAt: isDelete ? now : null, ...stampUpdate };
      await upsertOrSoftDelete(
        tx.customer,
        entry.id,
        isDelete,
        { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.CustomerUncheckedCreateInput,
        base as unknown as Prisma.CustomerUncheckedUpdateInput,
      );
      break;
    }
    case 'sessions': {
      const base = { ...payload, updatedAt: now, deletedAt: isDelete ? now : null, ...stampUpdate };
      await upsertOrSoftDelete(
        tx.session,
        entry.id,
        isDelete,
        { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.SessionUncheckedCreateInput,
        base as unknown as Prisma.SessionUncheckedUpdateInput,
      );
      break;
    }
    case 'expenses': {
      const base = { ...payload, updatedAt: now, deletedAt: isDelete ? now : null, ...stampUpdate };
      await upsertOrSoftDelete(
        tx.expense,
        entry.id,
        isDelete,
        { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.ExpenseUncheckedCreateInput,
        base as unknown as Prisma.ExpenseUncheckedUpdateInput,
      );
      break;
    }
    case 'creditEntries': {
      // No deletedAt column -- not soft-deletable, only updatedAt is stamped.
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
    case 'offers': {
      const base = { ...payload, updatedAt: now, ...stampUpdate };
      await tx.offer.upsert({
        where: { id: entry.id },
        create: { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.OfferUncheckedCreateInput,
        update: base as unknown as Prisma.OfferUncheckedUpdateInput,
      });
      break;
    }
    case 'categories': {
      // Server-seeded, no CRUD UI pushes this today -- handled uniformly anyway.
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
      await upsertOrSoftDelete(
        tx.product,
        entry.id,
        isDelete,
        { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.ProductUncheckedCreateInput,
        base as unknown as Prisma.ProductUncheckedUpdateInput,
      );
      break;
    }
    case 'orders': {
      const base = { ...payload, updatedAt: now, deletedAt: isDelete ? now : null };
      await upsertOrSoftDelete(
        tx.order,
        entry.id,
        isDelete,
        { id: entry.id, ...base, ...stampCreate } as unknown as Prisma.OrderUncheckedCreateInput,
        base as unknown as Prisma.OrderUncheckedUpdateInput,
      );
      break;
    }
    case 'orderItems': {
      // Immutable line items -- no deletedAt.
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
    case 'offers':
      return (await tx.offer.findUnique({ where: { id }, select: { id: true } })) !== null;
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

// One transaction PER ENTRY, not one shared transaction for the whole batch:
// Postgres aborts an ENTIRE transaction after any statement errors (SQLSTATE
// 25P02), even if the app catches it -- so a shared transaction would let one
// bad entry silently kill every entry after it. Per-entry transactions keep
// failures isolated and retries safe, and each entry's ActivityLog row is
// written in that same transaction so a failed entry never logs a phantom write.
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
  // categories/stations have no updatedAt column, so every pull returns the full set.
  const [
    sessions, expenses, customers, creditEntries, rates, offers, categories, stations,
    productCategories, products, orders, orderItems, stockMovements,
  ] = await Promise.all([
    prisma.session.findMany({ where }),
    prisma.expense.findMany({ where }),
    prisma.customer.findMany({ where }),
    prisma.creditEntry.findMany({ where }),
    prisma.rate.findMany({ where }),
    prisma.offer.findMany({ where }),
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
    sessions.length + expenses.length + customers.length + creditEntries.length + rates.length + offers.length +
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
    offers,
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
