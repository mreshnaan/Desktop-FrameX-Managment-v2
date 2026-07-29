import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { applyPush, pullSince } from '../services/sync.service';
import { prisma } from '../db';

vi.mock('../db', () => {
  // "doesn't exist yet" by default -> every entry logs as a create unless a
  // test overrides its own table's findUnique for that one call.
  const table = () => ({
    upsert: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  });
  const mockPrisma: any = {
    session: table(),
    expense: table(),
    customer: table(),
    creditEntry: table(),
    rate: table(),
    offer: table(),
    category: table(),
    station: table(),
    productCategory: table(),
    product: table(),
    order: table(),
    orderItem: table(),
    stockMovement: table(),
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    activityLog: { create: vi.fn() },
    syncLog: { create: vi.fn() },
  };
  // Real Prisma interactive transactions run the callback against a tx client;
  // for these unit tests the tx client is just the same mocked prisma object,
  // which is enough to exercise applyPush's per-entry try/catch behavior.
  mockPrisma.$transaction = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma));
  return { prisma: mockPrisma };
});

describe('applyPush', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts a customer row, letting the server stamp updatedAt', async () => {
    const result = await applyPush([
      { table: 'customers', op: 'upsert', id: 'c1', payload: { id: 'c1', name: 'Ravi', phone: '' }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.customer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1' },
      create: expect.objectContaining({ id: 'c1', name: 'Ravi' }),
      update: expect.objectContaining({ name: 'Ravi' }),
    }));
    expect(result.failed).toEqual([]);
  });

  it('soft-deletes by setting deletedAt instead of removing the row', async () => {
    await applyPush([{ table: 'customers', op: 'delete', id: 'c1', payload: {}, clientUpdatedAt: new Date().toISOString() }]);
    const call = (prisma.customer.update as any).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  // Regression test: a "delete" outbox entry's payload is minimal (just id
  // + updatedBy -- see e.g. do_delete_session in apps/desktop/src-tauri),
  // never a full row. upsert() validates its `create` argument's shape up
  // front, before it even checks whether the row exists to decide
  // create-vs-update -- so routing a delete through upsert() means the
  // incomplete payload always fails "required field missing" validation,
  // on every single retry, even when the row genuinely exists server-side.
  // A delete must go through update(), never upsert().
  it('routes a delete through update(), never upsert() -- upsert would validate the minimal delete payload as a doomed create', async () => {
    await applyPush([{ table: 'customers', op: 'delete', id: 'c1', payload: { id: 'c1' }, clientUpdatedAt: new Date().toISOString() }]);
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' } }));
    expect(prisma.customer.upsert).not.toHaveBeenCalled();
  });

  it('treats deleting a row that was never pushed (or is already gone) as a no-op, not a failure', async () => {
    const notFoundError = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    vi.mocked(prisma.customer.update).mockRejectedValueOnce(notFoundError);

    const result = await applyPush([
      { table: 'customers', op: 'delete', id: 'never-existed', payload: { id: 'never-existed' }, clientUpdatedAt: new Date().toISOString() },
    ]);

    expect(result.failed).toEqual([]);
  });

  it('runs each entry in its own transaction', async () => {
    await applyPush([
      { table: 'customers', op: 'upsert', id: 'c1', payload: { id: 'c1', name: 'Ravi', phone: '' }, clientUpdatedAt: new Date().toISOString() },
      { table: 'customers', op: 'upsert', id: 'c2', payload: { id: 'c2', name: 'Meera', phone: '' }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('isolates a malformed entry: other entries in the batch still commit and the failure is reported, not thrown', async () => {
    vi.mocked(prisma.customer.upsert)
      .mockResolvedValueOnce({} as any) // c1 succeeds
      .mockRejectedValueOnce(new Error('invalid payload: name is required')) // c2 fails
      .mockResolvedValueOnce({} as any); // c3 succeeds

    const entries = [
      { table: 'customers' as const, op: 'upsert' as const, id: 'c1', payload: { id: 'c1', name: 'Ravi', phone: '' }, clientUpdatedAt: new Date().toISOString() },
      { table: 'customers' as const, op: 'upsert' as const, id: 'c2', payload: { id: 'c2' }, clientUpdatedAt: new Date().toISOString() },
      { table: 'customers' as const, op: 'upsert' as const, id: 'c3', payload: { id: 'c3', name: 'Meera', phone: '' }, clientUpdatedAt: new Date().toISOString() },
    ];

    await expect(applyPush(entries)).resolves.toEqual({
      failed: [{ id: 'c2', table: 'customers', error: 'invalid payload: name is required' }],
    });

    expect(prisma.customer.upsert).toHaveBeenCalledTimes(3);
  });

  it('upserts a rate keyed by id, not categoryId', async () => {
    await applyPush([
      { table: 'rates', op: 'upsert', id: 'rate-1', payload: { categoryId: 'cat-1', hour: 200, half: 100, value: null }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.rate.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'rate-1' },
      create: expect.objectContaining({ id: 'rate-1', categoryId: 'cat-1' }),
    }));
  });

  it('upserts an offer, with no deletedAt handling since offers are never soft-deleted', async () => {
    await applyPush([
      {
        table: 'offers',
        op: 'upsert',
        id: 'offer-1',
        payload: {
          name: 'Weekday Special',
          active: true,
          appliesToAllCategories: false,
          categoryIds: 'cat-1',
          days: 'mon,tue,wed,thu,fri',
          effectType: 'extraTime',
          effectValue: 30,
        },
        clientUpdatedAt: new Date().toISOString(),
      },
    ]);
    expect(prisma.offer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'offer-1' },
      create: expect.objectContaining({ id: 'offer-1', name: 'Weekday Special', effectType: 'extraTime' }),
      update: expect.objectContaining({ name: 'Weekday Special', effectType: 'extraTime' }),
    }));
    const call = (prisma.offer.upsert as any).mock.calls[0][0];
    expect(call.update.deletedAt).toBeUndefined();
  });

  it('upserts a category row', async () => {
    await applyPush([
      { table: 'categories', op: 'upsert', id: 'cat-1', payload: { name: '8-Ball', billingType: 'time' }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.category.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cat-1' },
      create: expect.objectContaining({ id: 'cat-1', name: '8-Ball' }),
    }));
  });

  it('upserts a station row', async () => {
    await applyPush([
      { table: 'stations', op: 'upsert', id: 'st-1', payload: { categoryId: 'cat-1', name: 'Table 1' }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.station.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'st-1' },
      create: expect.objectContaining({ id: 'st-1', categoryId: 'cat-1' }),
    }));
  });

  it('upserts a product, soft-deleting via deletedAt like customers/sessions', async () => {
    await applyPush([
      { table: 'products', op: 'upsert', id: 'p1', payload: { categoryId: 'pc-1', name: 'Cola', price: 50, stockQty: 10 }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.product.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      create: expect.objectContaining({ id: 'p1', name: 'Cola', deletedAt: null }),
    }));
  });

  it('upserts an order and its order items as separate table entries', async () => {
    await applyPush([
      { table: 'orders', op: 'upsert', id: 'o1', payload: { method: 'Cash', total: 100, customerId: null }, clientUpdatedAt: new Date().toISOString() },
      { table: 'orderItems', op: 'upsert', id: 'oi1', payload: { orderId: 'o1', productId: 'p1', qty: 2, unitPrice: 50, lineTotal: 100 }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.order.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'o1' },
      create: expect.objectContaining({ id: 'o1', total: 100 }),
    }));
    expect(prisma.orderItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'oi1' },
      create: expect.objectContaining({ id: 'oi1', orderId: 'o1', productId: 'p1' }),
    }));
  });

  it('upserts a stock movement', async () => {
    await applyPush([
      { table: 'stockMovements', op: 'upsert', id: 'sm1', payload: { productId: 'p1', delta: -2, reason: 'sale' }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.stockMovement.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sm1' },
      create: expect.objectContaining({ id: 'sm1', productId: 'p1', delta: -2 }),
    }));
  });

  it('always writes exactly one SyncLog row per push call, regardless of entry count', async () => {
    await applyPush([
      { table: 'customers', op: 'upsert', id: 'c1', payload: { id: 'c1', name: 'Ravi', phone: '' }, clientUpdatedAt: new Date().toISOString() },
      { table: 'customers', op: 'upsert', id: 'c2', payload: { id: 'c2', name: 'Meera', phone: '' }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.syncLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.syncLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ direction: 'push', entryCount: 2, failedCount: 0 }),
    }));
  });

  it('stamps createdBy/updatedBy and writes an ActivityLog entry when an actor is provided', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u1', name: 'Owner' } as any);

    await applyPush(
      [{ table: 'customers', op: 'upsert', id: 'c1', payload: { id: 'c1', name: 'Ravi', phone: '' }, clientUpdatedAt: new Date().toISOString() }],
      'u1',
    );

    expect(prisma.customer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ createdBy: 'u1', updatedBy: 'u1' }),
      update: expect.objectContaining({ updatedBy: 'u1' }),
    }));
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        userName: 'Owner',
        action: 'create',
        tableName: 'customers',
        entityId: 'c1',
        summary: expect.stringContaining('Created'),
      }),
    });
  });

  it('stamps only createdBy (never updatedBy) on an append-only table -- that column does not exist on it', async () => {
    // orders/orderItems/creditEntries/stockMovements have no updatedBy column
    // (see schema.prisma) -- including it in `create` throws a Prisma
    // "unknown argument" error.
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u1', name: 'Owner' } as any);

    await applyPush(
      [{ table: 'stockMovements', op: 'upsert', id: 'sm1', payload: { productId: 'p1', delta: -2, reason: 'sale' }, clientUpdatedAt: new Date().toISOString() }],
      'u1',
    );

    const call = vi.mocked(prisma.stockMovement.upsert).mock.calls[0][0] as any;
    expect(call.create).toMatchObject({ createdBy: 'u1' });
    expect(call.create).not.toHaveProperty('updatedBy');
  });

  it('logs an update (not a create) when the row already exists', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'u1', name: 'Owner' } as any);
    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({ id: 'c1' } as any);

    await applyPush(
      [{ table: 'customers', op: 'upsert', id: 'c1', payload: { id: 'c1', name: 'Ravi', phone: '' }, clientUpdatedAt: new Date().toISOString() }],
      'u1',
    );

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'update', summary: expect.stringContaining('Updated') }),
    });
  });

  it('never trusts a createdBy/updatedBy the client put in its own payload -- only the server-resolved actor', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'real-actor', name: 'Owner' } as any);
    vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({ id: 'c1' } as any); // pre-existing -> update path

    await applyPush(
      [{
        table: 'customers', op: 'upsert', id: 'c1',
        payload: { id: 'c1', name: 'Ravi', phone: '', createdBy: 'spoofed', updatedBy: 'spoofed' },
        clientUpdatedAt: new Date().toISOString(),
      }],
      'real-actor',
    );

    const call = (prisma.customer.upsert as any).mock.calls[0][0];
    expect(call.update.updatedBy).toBe('real-actor');
    expect(call.update.createdBy).toBeUndefined();
  });

  it('does not write createdBy/updatedBy or an ActivityLog entry when no actor is given', async () => {
    await applyPush([
      { table: 'customers', op: 'upsert', id: 'c1', payload: { id: 'c1', name: 'Ravi', phone: '' }, clientUpdatedAt: new Date().toISOString() },
    ]);
    const call = (prisma.customer.upsert as any).mock.calls[0][0];
    expect(call.create.createdBy).toBeUndefined();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });
});

describe('pullSince', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes one SyncLog row summing the total rows returned across every table', async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }] as any);
    await pullSince(undefined, undefined);
    expect(prisma.syncLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ direction: 'pull', entryCount: 2 }),
    }));
  });
});
