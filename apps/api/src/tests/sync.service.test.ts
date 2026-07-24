import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyPush } from '../services/sync.service';
import { prisma } from '../db';

vi.mock('../db', () => {
  const mockPrisma: any = {
    session: { upsert: vi.fn() },
    expense: { upsert: vi.fn() },
    customer: { upsert: vi.fn() },
    creditEntry: { upsert: vi.fn() },
    rate: { upsert: vi.fn() },
    category: { upsert: vi.fn() },
    station: { upsert: vi.fn() },
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
    const call = (prisma.customer.upsert as any).mock.calls[0][0];
    expect(call.update.deletedAt).toBeInstanceOf(Date);
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
});
