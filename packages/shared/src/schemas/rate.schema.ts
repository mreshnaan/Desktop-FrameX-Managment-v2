import { z } from 'zod';

export const TimeRateSchema = z.object({
  category: z.string(),
  hour: z.coerce.number().min(0),
  half: z.coerce.number().min(0),
});
export const FrameRateSchema = z.object({
  category: z.string(),
  value: z.coerce.number().min(0),
});
export type TimeRateInput = z.infer<typeof TimeRateSchema>;
export type FrameRateInput = z.infer<typeof FrameRateSchema>;
