import { z } from 'zod';

// 4-digit numeric PIN (matches FrameX's PinKeypad UI), replacing password
// auth for both apps/web and apps/desktop.
const PinSchema = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');

export const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  pin: PinSchema,
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateUserSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  pin: PinSchema,
  name: z.string().min(1),
  roleId: z.string().min(1, 'Role is required'),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
