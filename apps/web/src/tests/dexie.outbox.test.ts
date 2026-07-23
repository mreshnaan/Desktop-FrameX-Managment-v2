import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, enqueueOutbox } from '../lib/db/dexie';

describe('dexie outbox', () => {
  beforeEach(async () => { await db.outbox.clear(); await db.customers.clear(); });

  it('records a pending mutation alongside the local write', async () => {
    const id = crypto.randomUUID();
    await db.customers.put({ id, name: 'Ravi', phone: '', updatedAt: new Date().toISOString(), deletedAt: null });
    await enqueueOutbox('customers', 'upsert', id, { id, name: 'Ravi' });

    const pending = await db.outbox.toArray();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ table: 'customers', op: 'upsert', id });
  });
});
