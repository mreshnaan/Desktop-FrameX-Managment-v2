import { z } from 'zod';
import { ROLES } from '../constants/roles.js';

export const LoginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(ROLES as unknown as [string, ...string[]]),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
