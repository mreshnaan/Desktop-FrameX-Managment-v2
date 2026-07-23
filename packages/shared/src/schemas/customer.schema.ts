import { z } from 'zod';

export const CustomerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  phone: z.string().optional().default(''),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Customer = z.infer<typeof CustomerSchema>;
export const CustomerDraftSchema = CustomerSchema.omit({ id: true, updatedAt: true, deletedAt: true });
export type CustomerDraft = z.infer<typeof CustomerDraftSchema>;
