import { z } from 'zod';
import { CATEGORIES } from '../constants/categories';

const categoryNames = CATEGORIES.map(c => c.name) as [string, ...string[]];

const sessionBaseSchema = z.object({
  id: z.string().uuid(),
  category: z.enum(categoryNames),
  resource: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
  end: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
  amount: z.coerce.number().int().min(0),
  method: z.enum(['Cash', 'Card', 'Credit']),
  customerId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export const SessionSchema = sessionBaseSchema.refine(
  data => data.method !== 'Credit' || !!data.customerId,
  { message: 'A customer must be selected for Credit sessions', path: ['customerId'] }
);

export type Session = z.infer<typeof SessionSchema>;

export const SessionDraftSchema = sessionBaseSchema.omit({ id: true, updatedAt: true, deletedAt: true });
export type SessionDraft = z.infer<typeof SessionDraftSchema>;
