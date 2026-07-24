import { z } from 'zod';

export const ExpenseSchema = z.object({
  id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().int().positive('Amount must be greater than 0'),
  method: z.enum(['Cash', 'Card']),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Expense = z.infer<typeof ExpenseSchema>;
export const ExpenseDraftSchema = ExpenseSchema.omit({ id: true, updatedAt: true, deletedAt: true });
export type ExpenseDraft = z.infer<typeof ExpenseDraftSchema>;
