import { z } from 'zod';

export const SyncTableName = z.enum([
  'sessions',
  'expenses',
  'customers',
  'creditEntries',
  'rates',
  'offers',
  'categories',
  'stations',
  'productCategories',
  'products',
  'orders',
  'orderItems',
  'stockMovements',
]);

export const OutboxEntrySchema = z.object({
  table: SyncTableName,
  op: z.enum(['upsert', 'delete']),
  id: z.string().min(1),
  payload: z.record(z.unknown()),
  clientUpdatedAt: z.string().datetime(),
});
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>;

export const SyncPushSchema = z.object({ entries: z.array(OutboxEntrySchema).max(500) });
export type SyncPushInput = z.infer<typeof SyncPushSchema>;

export const SyncPullQuerySchema = z.object({ since: z.string().datetime().optional() });
export type SyncPullQuery = z.infer<typeof SyncPullQuerySchema>;
