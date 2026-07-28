import { z } from 'zod';

const timeRegex = /^\d{2}:\d{2}$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const OfferSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  active: z.boolean(),
  appliesToAllCategories: z.boolean(),
  categoryIds: z.string().nullable(),
  days: z.string().nullable(),
  startTime: z.string().regex(timeRegex).nullable(),
  endTime: z.string().regex(timeRegex).nullable(),
  startDate: z.string().regex(dateRegex).nullable(),
  endDate: z.string().regex(dateRegex).nullable(),
  minDurationMinutes: z.coerce.number().int().positive().nullable(),
  minGameCount: z.coerce.number().int().positive().nullable(),
  effectType: z.enum(['extraTime', 'percentOff', 'flatOff']),
  effectValue: z.coerce.number().int().min(0),
  updatedAt: z.string().datetime().optional(),
}).refine(
  data => data.appliesToAllCategories || !!data.categoryIds,
  { message: 'Select at least one category, or choose "All categories"', path: ['categoryIds'] }
).refine(
  data => data.effectType !== 'percentOff' || data.effectValue <= 100,
  { message: 'Percent off cannot exceed 100', path: ['effectValue'] }
);

export type Offer = z.infer<typeof OfferSchema>;

export const OfferDraftSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  active: z.boolean(),
  appliesToAllCategories: z.boolean(),
  categoryIds: z.string().nullable(),
  days: z.string().nullable(),
  startTime: z.string().regex(timeRegex).nullable(),
  endTime: z.string().regex(timeRegex).nullable(),
  startDate: z.string().regex(dateRegex).nullable(),
  endDate: z.string().regex(dateRegex).nullable(),
  minDurationMinutes: z.coerce.number().int().positive().nullable(),
  minGameCount: z.coerce.number().int().positive().nullable(),
  effectType: z.enum(['extraTime', 'percentOff', 'flatOff']),
  effectValue: z.coerce.number().int().min(0),
}).refine(
  data => data.appliesToAllCategories || !!data.categoryIds,
  { message: 'Select at least one category, or choose "All categories"', path: ['categoryIds'] }
).refine(
  data => data.effectType !== 'percentOff' || data.effectValue <= 100,
  { message: 'Percent off cannot exceed 100', path: ['effectValue'] }
);

export type OfferDraft = z.infer<typeof OfferDraftSchema>;
