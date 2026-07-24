import { z } from 'zod';

export const TimeRateSchema = z.object({
  categoryId: z.string().min(1),
  hour: z.coerce.number().int().min(0),
  half: z.coerce.number().int().min(0),
});
export const FrameRateSchema = z.object({
  categoryId: z.string().min(1),
  value: z.coerce.number().int().min(0),
});
export type TimeRateInput = z.infer<typeof TimeRateSchema>;
export type FrameRateInput = z.infer<typeof FrameRateSchema>;
