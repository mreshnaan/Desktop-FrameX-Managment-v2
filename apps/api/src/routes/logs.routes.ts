import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate } from '../middleware/auth';
import { requireView } from '../middleware/requireRole';

export const logsRouter = Router();
logsRouter.use(authenticate, requireView('auditLog'));

const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  userId: z.string().optional(),
  tableName: z.string().optional(),
});

logsRouter.get('/activity-logs', async (req, res) => {
  const parsed = PageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { page, pageSize, userId, tableName } = parsed.data;
  const where = {
    ...(userId ? { userId } : {}),
    ...(tableName ? { tableName } : {}),
  };
  const [entries, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.activityLog.count({ where }),
  ]);
  res.json({ entries, total, page, pageSize });
});

logsRouter.get('/sync-logs', async (req, res) => {
  const parsed = PageQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { page, pageSize, userId } = parsed.data;
  const where = userId ? { userId } : {};
  const [entries, total] = await Promise.all([
    prisma.syncLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.syncLog.count({ where }),
  ]);
  res.json({ entries, total, page, pageSize });
});
