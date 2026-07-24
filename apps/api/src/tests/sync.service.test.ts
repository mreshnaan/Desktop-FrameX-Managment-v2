import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyPush } from '../services/sync.service';
import { prisma } from '../db';

vi.mock('../db', () => ({
  prisma: {
    session: { upsert: vi.fn() },
    expense: { upsert: vi.fn() },
    customer: { upsert: vi.fn() },
    creditEntry: { upsert: vi.fn() },
    rate: { upsert: vi.fn() },
  },
}));

describe('applyPush', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts a customer row, letting the server stamp updatedAt', async () => {
    await applyPush([
      { table: 'customers', op: 'upsert', id: 'c1', payload: { id: 'c1', name: 'Ravi', phone: '' }, clientUpdatedAt: new Date().toISOString() },
    ]);
    expect(prisma.customer.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1' },
      create: expect.objectContaining({ id: 'c1', name: 'Ravi' }),
      update: expect.objectContaining({ name: 'Ravi' }),
    }));
  });

  it('soft-deletes by setting deletedAt instead of removing the row', async () => {
    await applyPush([{ table: 'customers', op: 'delete', id: 'c1', payload: {}, clientUpdatedAt: new Date().toISOString() }]);
    const call = (prisma.customer.upsert as any).mock.calls[0][0];
    expect(call.update.deletedAt).toBeInstanceOf(Date);
  });
});
