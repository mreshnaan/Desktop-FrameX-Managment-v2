import { z } from 'zod';

const sessionBaseSchema = z.object({
  id: z.string().uuid(),
  stationId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
  end: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
  amount: z.coerce.number().int().min(0),
  method: z.enum(['Cash', 'Card', 'Credit']),
  customerId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
  metadata: z.string().nullable(),
});

const checkCreditCustomer = (data: {
  method: string;
  customerId: string | null;
}) => data.method !== 'Credit' || !!data.customerId;

const creditCustomerError = {
  message: 'A customer must be selected for Credit sessions',
  path: ['customerId'],
};

export const SessionSchema = sessionBaseSchema.refine(
  checkCreditCustomer,
  creditCustomerError
);

export type Session = z.infer<typeof SessionSchema>;

export const SessionDraftSchema = sessionBaseSchema
  .omit({ id: true, updatedAt: true, deletedAt: true, metadata: true })
  .refine(checkCreditCustomer, creditCustomerError);

export type SessionDraft = z.infer<typeof SessionDraftSchema>;
