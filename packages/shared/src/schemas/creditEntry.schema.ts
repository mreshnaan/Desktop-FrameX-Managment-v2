import { z } from 'zod';

export const CreditEntrySchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['CREDIT_GIVEN', 'PAYMENT_RECEIVED']),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  updatedAt: z.string().datetime().optional(),
});
export type CreditEntry = z.infer<typeof CreditEntrySchema>;

export const CreditDraftSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
});
export type CreditDraft = z.infer<typeof CreditDraftSchema>;
