import { Router } from 'express';
import type { Role } from '@prisma/client';
import { CreateUserSchema } from '../shared/index';
import { prisma } from '../db';
import { hashPassword } from '../lib/password';
import { authenticate } from '../middleware/auth';
import { requireView } from '../middleware/requireRole';

export const usersRouter = Router();
usersRouter.use(authenticate, requireView('userManagement'));

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, createdAt: true } });
  res.json(users);
});

usersRouter.post('/', async (req, res) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: { email: parsed.data.email, passwordHash, name: parsed.data.name, role: parsed.data.role as Role },
    select: { id: true, email: true, name: true, role: true },
  });
  res.status(201).json(user);
});
