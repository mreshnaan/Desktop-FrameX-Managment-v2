import { prisma } from '../db';
import type { OutboxEntry } from '../shared/index';

export async function applyPush(entries: OutboxEntry[]): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    const isDelete = entry.op === 'delete';

    switch (entry.table) {
      case 'customers': {
        const base = { ...entry.payload, updatedAt: now, deletedAt: isDelete ? now : null };
        await prisma.customer.upsert({ where: { id: entry.id }, create: { id: entry.id, ...base } as any, update: base as any });
        break;
      }
      case 'sessions': {
        const base = { ...entry.payload, updatedAt: now, deletedAt: isDelete ? now : null };
        await prisma.session.upsert({ where: { id: entry.id }, create: { id: entry.id, ...base } as any, update: base as any });
        break;
      }
      case 'expenses': {
        const base = { ...entry.payload, updatedAt: now, deletedAt: isDelete ? now : null };
        await prisma.expense.upsert({ where: { id: entry.id }, create: { id: entry.id, ...base } as any, update: base as any });
        break;
      }
      case 'creditEntries': {
        // CreditEntry has no deletedAt column — deletes are not soft-deletable here, only updatedAt is stamped.
        const base = { ...entry.payload, updatedAt: now };
        await prisma.creditEntry.upsert({ where: { id: entry.id }, create: { id: entry.id, ...base } as any, update: base as any });
        break;
      }
      case 'rates': {
        // Rate has no deletedAt column and is keyed by `category`, not `id`.
        const base = { ...entry.payload, updatedAt: now };
        await prisma.rate.upsert({ where: { category: entry.id }, create: { category: entry.id, ...base } as any, update: base as any });
        break;
      }
    }
  }
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
