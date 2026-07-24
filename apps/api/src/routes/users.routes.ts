import { Router } from 'express';
import { CreateUserSchema } from '../shared/index';
import { prisma } from '../db';
import { hashPassword } from '../lib/password';
import { authenticate } from '../middleware/auth';
import { requireView } from '../middleware/requireRole';

export const usersRouter = Router();
usersRouter.use(authenticate, requireView('userManagement'));

const userSelect = {
  id: true,
  username: true,
  name: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
} as const;

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ select: userSelect });
  res.json(users);
});

usersRouter.post('/', async (req, res) => {
  const parsed = CreateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const pinHash = await hashPassword(parsed.data.pin);
  try {
    const user = await prisma.user.create({
      data: { username: parsed.data.username, pinHash, name: parsed.data.name, roleId: parsed.data.roleId },
      select: userSelect,
    });
    res.status(201).json(user);
  } catch {
    // Most likely an unknown roleId (FK violation) or a duplicate username.
    res.status(400).json({ error: 'Could not create user -- check the username and role' });
  }
});
